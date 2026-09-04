import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AccountType, FinancialAccountPurpose, UserStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { TransactionService } from '../src/infrastructure/database/transaction.service.js';
import { FeesService } from '../src/modules/fees/fees.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import type { TransactionalNotificationService } from '../src/modules/notifications/transactional-notification.service.js';
import { PaymentSettlementService } from '../src/modules/payments/payment-settlement.service.js';

const runDatabaseTests =
  process.env.CI === 'true' || process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeWithDatabase = runDatabaseTests ? describe : describe.skip;

/**
 * The deposit path end to end against real PostgreSQL: a tiered fee resolved
 * from seeded definitions, and a webhook settlement that credits a wallet.
 * This is the only way money enters the platform, so it is worth proving
 * against a database rather than mocks alone.
 */
describeWithDatabase('deposit settlement (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const transactions = {
    run: <T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
      isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel
        .ReadCommitted,
    ) => prisma.$transaction(operation, { isolationLevel, maxWait: 15_000, timeout: 30_000 }),
    serializable: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 15_000,
        timeout: 30_000,
      }),
  };
  const fees = new FeesService(prisma as unknown as PrismaService);
  const ledger = new LedgerService(transactions as unknown as TransactionService);
  // Stubbed: these tests assert money movement, and a real provider would try
  // to reach Expo from a test run. Delivery has its own tests.
  const notifications = {
    notify: jest.fn().mockResolvedValue({ inApp: true, pushed: 0 }),
  } as unknown as TransactionalNotificationService;

  const settlement = new PaymentSettlementService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    ledger,
    notifications,
  );

  let userId: string;
  let walletId: string;
  let availableId: string;
  const suffix = randomUUID();

  beforeAll(async () => {
    // Deposit fee: 2% floor, 1.5% provider rate, ₦50 markup below ₦10,000 and
    // ₦100 from ₦10,000 — the seeded shape from ADR-009.
    const definition = await prisma.feeDefinition.upsert({
      where: { code_version: { code: 'DEPOSIT', version: 1 } },
      update: { basisPoints: 200, providerRateBasisPoints: 150, providerFlatMinor: 0n },
      create: {
        code: 'DEPOSIT',
        version: 1,
        name: 'Wallet deposit fee',
        calculationType: 'TIERED',
        basisPoints: 200,
        providerRateBasisPoints: 150,
        providerFlatMinor: 0n,
        currency: 'NGN',
        payerType: 'USER',
        chargeEvent: 'DEPOSIT_SETTLED',
        effectiveAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.feeTier.deleteMany({ where: { feeDefinitionId: definition.id } });
    await prisma.feeTier.createMany({
      data: [
        { feeDefinitionId: definition.id, fromMinor: 0n, toMinor: 1_000_000n, amountMinor: 5_000n },
        {
          feeDefinitionId: definition.id,
          fromMinor: 1_000_000n,
          toMinor: null,
          amountMinor: 10_000n,
        },
      ],
    });

    const user = await prisma.user.create({
      data: { email: `depositor-${suffix}@example.test`, status: UserStatus.ACTIVE },
    });
    userId = user.id;
    const wallet = await prisma.wallet.create({ data: { userId, currency: 'NGN' } });
    walletId = wallet.id;

    const available = await prisma.financialAccount.create({
      data: {
        code: `TEST:${suffix}:AVAILABLE`,
        name: 'Available',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
        currency: 'NGN',
        walletId,
      },
    });
    availableId = available.id;
    for (const [purpose, type] of [
      [FinancialAccountPurpose.PROVIDER_PAYABLE, AccountType.ASSET],
      [FinancialAccountPurpose.PLATFORM_FEE_REVENUE, AccountType.REVENUE],
    ] as const) {
      const existing = await prisma.financialAccount.findFirst({
        where: { purpose, currency: 'NGN', walletId: null },
      });
      if (!existing) {
        await prisma.financialAccount.create({
          data: {
            code: `PLATFORM:${purpose}:NGN`,
            name: purpose,
            type,
            purpose,
            currency: 'NGN',
          },
        });
      }
    }
  });

  afterAll(async () => prisma.$disconnect());

  it('prices a ₦15,000 deposit from the seeded tiers', async () => {
    const assessed = await fees.assess('DEPOSIT', 1_500_000n);
    expect(assessed.amountMinor).toBe(32_500n);
    expect(assessed.definitionId).not.toBeNull();
  });

  it('charges the lower markup below the band boundary', async () => {
    // ₦1,000: provider ₦15 plus a ₦50 markup, above the ₦20 percentage floor.
    expect((await fees.assess('DEPOSIT', 100_000n)).amountMinor).toBe(6_500n);
  });

  it('credits the wallet net of the fee when the webhook settles', async () => {
    const intent = await prisma.paymentIntent.create({
      data: {
        userId,
        walletId,
        status: 'PROCESSING',
        targetType: 'WALLET_TOPUP',
        amountMinor: 1_500_000n,
        feeMinor: 32_500n,
        totalMinor: 1_500_000n,
        currency: 'NGN',
        method: 'TRANSFER',
        providerReference: `monnify-${suffix}`,
        idempotencyKey: `deposit-${suffix}`,
        expiresAt: new Date(Date.now() + 900_000),
      },
    });

    const outcome = await settlement.settleSuccessful(`monnify-${suffix}`);
    expect(outcome.status).toBe('SETTLED');

    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: availableId },
      select: { direction: true, amountMinor: true },
    });
    const credited = entries
      .filter((entry) => entry.direction === 'CREDIT')
      .reduce((total, entry) => total + entry.amountMinor, 0n);
    // ₦15,000 in, ₦325 fee, ₦14,675 credited.
    expect(credited).toBe(1_467_500n);

    const settled = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(settled.status).toBe('SUCCEEDED');
    expect(settled.ledgerTransactionId).not.toBeNull();
  });

  it('does not credit twice when the webhook is redelivered', async () => {
    const before = await prisma.ledgerEntry.count({ where: { accountId: availableId } });
    const outcome = await settlement.settleSuccessful(`monnify-${suffix}`);
    expect(outcome.status).toBe('ALREADY_SETTLED');
    expect(await prisma.ledgerEntry.count({ where: { accountId: availableId } })).toBe(before);
  });

  it('reports an unmatched reference rather than posting', async () => {
    expect(await settlement.settleSuccessful('monnify-never-seen')).toEqual({
      status: 'UNMATCHED',
    });
  });
});
