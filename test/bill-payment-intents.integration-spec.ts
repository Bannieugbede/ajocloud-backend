import { PrismaPg } from '@prisma/adapter-pg';
import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  AccountType,
  FinancialAccountPurpose,
  PaymentMethod,
  PaymentTargetType,
  UserStatus,
} from '../generated/prisma/enums.js';
import type { Environment } from '../src/config/env.schema.js';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { TransactionService } from '../src/infrastructure/database/transaction.service.js';
import type { AuditService } from '../src/modules/audit/audit.service.js';
import type { TransactionPinService } from '../src/modules/auth/transaction-pin.service.js';
import { BillPaymentTarget } from '../src/modules/bill-payments/bill-payment.payment-target.js';
import { BillPaymentsService } from '../src/modules/bill-payments/bill-payments.service.js';
import type { CreateBillPaymentInput } from '../src/modules/bill-payments/providers/bill-payment-provider.js';
import { MockBillPaymentProvider } from '../src/modules/bill-payments/providers/mock-bill-payment.provider.js';
import { FeesService } from '../src/modules/fees/fees.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { MockPaymentProvider } from '../src/modules/payments/providers/mock-payment.provider.js';
import type { PaymentTargetRegistry } from '../src/modules/payments/targets/payment-target.js';

const runDatabaseTests =
  process.env.CI === 'true' || process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeWithDatabase = runDatabaseTests ? describe : describe.skip;

type Category = { id: string; providerCode: string };
type Biller = {
  id: string;
  providerCode: string;
  products: { id: string; providerCode: string }[];
};
type Intent = {
  id: string;
  status: string;
  amountMinor: string;
  feeMinor: string;
  totalMinor: string;
  methods: readonly string[];
  description: string;
  failureReason: string | null;
};

/**
 * A bill paid through the shared payment intent, against real PostgreSQL:
 * quoted, confirmed with the PIN, reserved in one transaction, sent to the
 * provider after it commits, and finished according to what the provider says.
 */
describeWithDatabase('bill payments through payment intents (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const transactions = {
    run: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction(operation, { maxWait: 15_000, timeout: 30_000 }),
    serializable: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 15_000,
        timeout: 30_000,
      }),
  };
  const ledger = new LedgerService(transactions as unknown as TransactionService);
  const config = {
    get: () => 'integration-only-pepper-at-least-32-characters',
  } as unknown as ConfigService<Environment, true>;

  const suffix = randomUUID();
  // A provider of its own, whose outage can be switched on per test.
  let providerDown = false;
  class IsolatedProvider extends MockBillPaymentProvider {
    override readonly name = `pi-${suffix.slice(0, 8)}`;
    override createPayment(input: CreateBillPaymentInput) {
      if (providerDown) return Promise.reject(new Error('provider unreachable'));
      return super.createPayment(input);
    }
  }
  const provider = new IsolatedProvider();
  const bills = new BillPaymentsService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    ledger,
    provider,
    config,
  );
  const pins = { verifyPin: jest.fn().mockResolvedValue(undefined) };
  const payments = new PaymentsService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    ledger,
    pins as unknown as TransactionPinService,
    { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    new FeesService(prisma as unknown as PrismaService),
    new MockPaymentProvider(),
    { BILL_PAYMENT: new BillPaymentTarget(bills) } as unknown as PaymentTargetRegistry,
  );

  let userId: string;
  let availableId: string;
  let reservedId: string;
  let payableId: string;
  let revenueId: string;

  const balance = (accountId: string) =>
    transactions.run((tx) => ledger.accountBalanceWithin(tx, accountId));

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${suffix}@example.test`, status: UserStatus.ACTIVE },
    });
    userId = user.id;
    const wallet = await prisma.wallet.create({ data: { userId, currency: 'NGN' } });
    const account = (purpose: FinancialAccountPurpose, walletId: string | null, code: string) =>
      prisma.financialAccount.create({
        data: {
          code,
          name: code,
          type:
            purpose === FinancialAccountPurpose.PLATFORM_FEE_REVENUE
              ? AccountType.REVENUE
              : AccountType.LIABILITY,
          purpose,
          currency: 'NGN',
          ...(walletId ? { walletId } : {}),
        },
      });
    availableId = (
      await account(FinancialAccountPurpose.WALLET_AVAILABLE, wallet.id, `PI:${suffix}:A`)
    ).id;
    reservedId = (
      await account(FinancialAccountPurpose.WALLET_RESERVED, wallet.id, `PI:${suffix}:R`)
    ).id;
    const platform = (purpose: FinancialAccountPurpose, code: string) =>
      prisma.financialAccount
        .findFirst({ where: { walletId: null, purpose, currency: 'NGN', isActive: true } })
        .then((found) => found ?? account(purpose, null, code));
    payableId = (
      await platform(FinancialAccountPurpose.PROVIDER_PAYABLE, 'PLATFORM:PROVIDER_PAYABLE:NGN')
    ).id;
    revenueId = (
      await platform(FinancialAccountPurpose.PLATFORM_FEE_REVENUE, 'PLATFORM:FEE_REVENUE:NGN')
    ).id;
    // The development fee every suite shares; the fee test adds a version above it.
    await prisma.feeDefinition.upsert({
      where: { code_version: { code: 'BILL_PAYMENT', version: 1 } },
      update: {},
      create: {
        code: 'BILL_PAYMENT',
        version: 1,
        name: 'Integration Bill Payment fee',
        calculationType: 'FIXED',
        amountMinor: 0n,
        currency: 'NGN',
        payerType: 'USER',
        chargeEvent: 'BILL_PAYMENT_CREATED',
        effectiveAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await ledger.post({
      idempotencyKey: `pi-fund:${suffix}`,
      reference: `PI-FUND-${suffix}`,
      description: 'Integration wallet funding',
      currency: 'NGN',
      entries: [
        { accountId: payableId, direction: 'DEBIT', amountMinor: 100_000_00n },
        { accountId: availableId, direction: 'CREDIT', amountMinor: 100_000_00n },
      ],
    });
  });

  afterAll(async () => prisma.$disconnect());

  async function biller(categoryCode: string, billerCode: string): Promise<Biller> {
    const categories = (await bills.categories()) as Category[];
    const category = categories.find((candidate) => candidate.providerCode === categoryCode);
    const list = (await bills.billers(category?.id ?? '')) as Biller[];
    const found = list.find((candidate) => candidate.providerCode === billerCode);
    if (!found) throw new Error(`Biller ${billerCode} is missing`);
    return found;
  }

  async function validated(
    billerCode: string,
    categoryCode: string,
    reference: string,
    productCode?: string,
  ) {
    const chosen = await biller(categoryCode, billerCode);
    const product = productCode
      ? chosen.products.find((candidate) => candidate.providerCode === productCode)
      : chosen.products[0];
    const validation = (await bills.validateCustomer(userId, {
      billerId: chosen.id,
      ...(product ? { productId: product.id } : {}),
      customerReference: reference,
    })) as { id: string };
    return validation.id;
  }

  const quote = (validationId: string, amountMinor?: string) =>
    payments.create(
      userId,
      {
        targetType: PaymentTargetType.BILL_PAYMENT,
        targetId: validationId,
        ...(amountMinor ? { amountMinor } : {}),
      },
      `quote:${randomUUID()}`,
    ) as Promise<Intent>;

  const confirm = (intentId: string, customerReference?: string) =>
    payments.confirm(
      userId,
      intentId,
      {
        method: PaymentMethod.WALLET,
        transactionPin: '1357',
        ...(customerReference ? { customerReference } : {}),
      },
      `confirm:${intentId}`,
    ) as Promise<Intent>;

  it('quotes a bill from the wallet, described by what is being paid', async () => {
    const intent = await quote(await validated('MTN', 'AIRTIME', '08031234567'), '100000');
    expect(intent).toMatchObject({
      status: 'REQUIRES_CONFIRMATION',
      amountMinor: '100000',
      methods: ['WALLET'],
      description: 'MTN · *******4567',
    });
  });

  it('charges a fixed package at its own price and refuses any other', async () => {
    const validationId = await validated('DSTV', 'CABLE_TV', '7020147841', 'DSTV-PADI');
    await expect(quote(validationId, '100')).rejects.toThrow('fixed amount');
    await expect(quote(validationId)).resolves.toMatchObject({ amountMinor: '440000' });
  });

  it('refuses a missing or different number before the PIN is asked', async () => {
    const intent = await quote(await validated('MTN', 'AIRTIME', '08031234567'), '100000');
    pins.verifyPin.mockClear();
    await expect(confirm(intent.id)).rejects.toThrow('missing');
    await expect(confirm(intent.id, '08037654321')).rejects.toThrow('not the one that was checked');
    expect(pins.verifyPin).not.toHaveBeenCalled();
  });

  it('pays the provider and settles the intent', async () => {
    const before = await balance(availableId);
    const payableBefore = await balance(payableId);
    const intent = await quote(await validated('MTN', 'AIRTIME', '08031234567'), '150000');
    const paid = await confirm(intent.id, '+234 803 123 4567');

    expect(paid.status).toBe('SUCCEEDED');
    // The total, not the amount: whatever fee is configured is charged too.
    const total = BigInt(paid.totalMinor);
    expect(await balance(availableId)).toBe(before - total);
    expect(await balance(payableId)).toBe(payableBefore + 1_500_00n);
    const bill = await prisma.billPayment.findUniqueOrThrow({
      where: { userId_idempotencyKey: { userId, idempotencyKey: `intent:${intent.id}` } },
    });
    expect(bill.status).toBe('SUCCESSFUL');

    // A retried confirmation returns the same payment rather than paying again.
    await expect(confirm(intent.id, '08031234567')).resolves.toMatchObject({ status: 'SUCCEEDED' });
    expect(await balance(availableId)).toBe(before - total);
  });

  it('returns every naira when the provider declines', async () => {
    const before = await balance(availableId);
    const intent = await quote(await validated('MTN', 'AIRTIME', '08031239999'), '100000');
    const failed = await confirm(intent.id, '08031239999');

    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toMatch(/back in your wallet/);
    expect(await balance(availableId)).toBe(before);
    expect(await balance(reservedId)).toBe(0n);
  });

  it('holds the money and leaves the payment processing when the provider cannot be reached', async () => {
    const before = await balance(availableId);
    const intent = await quote(await validated('GLO', 'AIRTIME', '08051234567'), '50000');
    providerDown = true;
    try {
      const pending = await confirm(intent.id, '08051234567');
      expect(pending.status).toBe('PROCESSING');
    } finally {
      providerDown = false;
    }
    const total = BigInt(intent.totalMinor);
    expect(await balance(availableId)).toBe(before - total);
    expect(await balance(reservedId)).toBe(total);
    const bill = await prisma.billPayment.findUniqueOrThrow({
      where: { userId_idempotencyKey: { userId, idempotencyKey: `intent:${intent.id}` } },
    });
    expect(bill.status).toBe('RECONCILIATION_REQUIRED');

    // Reconciliation finishes the bill and, with it, the payment the member saw.
    await bills.reconcile(userId, bill.id);
    await expect(payments.get(userId, intent.id)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    expect(await balance(reservedId)).toBe(0n);
  });

  it('holds the fee with the amount, earning it only when the bill completes', async () => {
    const latest = await prisma.feeDefinition.findFirst({
      where: { code: 'BILL_PAYMENT' },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const fee = await prisma.feeDefinition.create({
      data: {
        code: 'BILL_PAYMENT',
        version: (latest?.version ?? 0) + 1,
        name: 'Integration bill fee',
        calculationType: 'FIXED',
        amountMinor: 50_00n,
        currency: 'NGN',
        payerType: 'USER',
        chargeEvent: 'BILL_PAYMENT_CREATED',
        effectiveAt: new Date(Date.now() - 1_000),
      },
    });

    try {
      const revenueBefore = await balance(revenueId);
      const availableBefore = await balance(availableId);

      const declined = await quote(await validated('MTN', 'AIRTIME', '08031239999'), '100000');
      expect(declined).toMatchObject({ feeMinor: '5000', totalMinor: '105000' });
      await confirm(declined.id, '08031239999');
      expect(await balance(availableId)).toBe(availableBefore);
      expect(await balance(revenueId)).toBe(revenueBefore);

      const paid = await quote(await validated('MTN', 'AIRTIME', '08031234567'), '100000');
      await confirm(paid.id, '08031234567');
      expect(await balance(availableId)).toBe(availableBefore - 1_050_00n);
      expect(await balance(revenueId)).toBe(revenueBefore + 50_00n);
    } finally {
      // Other suites share this database and price bills without this fee.
      await prisma.feeDefinition.update({ where: { id: fee.id }, data: { isActive: false } });
    }
  });
});
