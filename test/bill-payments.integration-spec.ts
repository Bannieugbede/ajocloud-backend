import { PrismaPg } from '@prisma/adapter-pg';
import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AccountType, FinancialAccountPurpose, UserStatus } from '../generated/prisma/enums.js';
import type { Environment } from '../src/config/env.schema.js';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { TransactionService } from '../src/infrastructure/database/transaction.service.js';
import { BillPaymentsService } from '../src/modules/bill-payments/bill-payments.service.js';
import { MockBillPaymentProvider } from '../src/modules/bill-payments/providers/mock-bill-payment.provider.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';

const runDatabaseTests =
  process.env.CI === 'true' || process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeWithDatabase = runDatabaseTests ? describe : describe.skip;

type Category = { id: string; name: string; providerCode: string };
type Product = {
  id: string;
  providerCode: string;
  fixedAmountMinor: bigint | null;
  validity: string | null;
};
type Biller = {
  id: string;
  providerCode: string;
  referenceKind: string | null;
  referenceLabel: string;
  products: Product[];
};

/**
 * The bill flow a member walks through, against real PostgreSQL: the catalogue
 * is synced from the development provider, a retired category disappears, a
 * phone number typed three ways is one reference, and a paid bill moves money
 * through the ledger exactly once.
 */
describeWithDatabase('bill payments (PostgreSQL integration)', () => {
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

  // A provider name of its own, so this run's catalogue cannot collide with a
  // seeded one or another run's.
  const suffix = randomUUID();
  class IsolatedProvider extends MockBillPaymentProvider {
    override readonly name = `it-${suffix.slice(0, 8)}`;
  }
  const provider = new IsolatedProvider();
  const bills = new BillPaymentsService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    ledger,
    provider,
    config,
  );

  let userId: string;
  let walletId: string;
  let availableId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${suffix}@example.test`, status: UserStatus.ACTIVE },
    });
    userId = user.id;
    const wallet = await prisma.wallet.create({ data: { userId, currency: 'NGN' } });
    walletId = wallet.id;
    const account = (purpose: FinancialAccountPurpose, walletScoped: boolean, code: string) =>
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
          ...(walletScoped ? { walletId } : {}),
        },
      });
    const available = await account(
      FinancialAccountPurpose.WALLET_AVAILABLE,
      true,
      `IT:${suffix}:AVAILABLE`,
    );
    availableId = available.id;
    await account(FinancialAccountPurpose.WALLET_RESERVED, true, `IT:${suffix}:RESERVED`);
    const platform = await prisma.financialAccount.findFirst({
      where: { walletId: null, purpose: FinancialAccountPurpose.PROVIDER_PAYABLE, currency: 'NGN' },
    });
    const payable =
      platform ??
      (await account(
        FinancialAccountPurpose.PROVIDER_PAYABLE,
        false,
        'PLATFORM:PROVIDER_PAYABLE:NGN',
      ));
    const revenue = await prisma.financialAccount.findFirst({
      where: {
        walletId: null,
        purpose: FinancialAccountPurpose.PLATFORM_FEE_REVENUE,
        currency: 'NGN',
      },
    });
    if (!revenue) {
      await account(
        FinancialAccountPurpose.PLATFORM_FEE_REVENUE,
        false,
        'PLATFORM:FEE_REVENUE:NGN',
      );
    }
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
      idempotencyKey: `it-fund:${suffix}`,
      reference: `IT-FUND-${suffix}`,
      description: 'Integration wallet funding',
      currency: 'NGN',
      entries: [
        { accountId: payable.id, direction: 'DEBIT', amountMinor: 100_000_00n },
        { accountId: availableId, direction: 'CREDIT', amountMinor: 100_000_00n },
      ],
    });

    // A category from before the catalogue was defined, still unexpired: it
    // must be retired by the revision change, not left until it lapses.
    await prisma.billCategory.create({
      data: {
        provider: provider.name,
        providerCode: 'WATER',
        name: 'Water',
        refreshedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  async function category(code: string): Promise<Category> {
    const categories = (await bills.categories()) as Category[];
    const found = categories.find((candidate) => candidate.providerCode === code);
    if (!found) throw new Error(`Category ${code} is missing`);
    return found;
  }

  async function biller(categoryCode: string, billerCode: string): Promise<Biller> {
    const list = (await bills.billers((await category(categoryCode)).id)) as Biller[];
    const found = list.find((candidate) => candidate.providerCode === billerCode);
    if (!found) throw new Error(`Biller ${billerCode} is missing`);
    return found;
  }

  it('lists the four categories in order and retires Water', async () => {
    const categories = (await bills.categories()) as Category[];
    expect(categories.map((candidate) => candidate.name)).toEqual([
      'Airtime',
      'Internet',
      'Electricity',
      'Cable TV',
    ]);
    const water = await prisma.billCategory.findUniqueOrThrow({
      where: { provider_providerCode: { provider: provider.name, providerCode: 'WATER' } },
    });
    expect(water.status).toBe('INACTIVE');
  });

  it('shows each network with its data packages', async () => {
    const mtn = await biller('INTERNET', 'MTN-DATA');
    expect(mtn.referenceKind).toBe('phone');
    expect(mtn.referenceLabel).toBe('Phone number');
    expect(mtn.products.length).toBeGreaterThan(5);
    expect(mtn.products.every((product) => product.validity)).toBe(true);
    // Cheapest first, so the list reads like a price list.
    const prices = mtn.products.map((product) => product.fixedAmountMinor as bigint);
    expect([...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(prices);
  });

  it('explains a malformed phone number before asking the provider', async () => {
    const mtn = await biller('AIRTIME', 'MTN');
    await expect(
      bills.validateCustomer(userId, { billerId: mtn.id, customerReference: '0803123' }),
    ).rejects.toThrow('11-digit Nigerian phone number');
  });

  it('buys airtime for a number typed differently at each step', async () => {
    const mtn = await biller('AIRTIME', 'MTN');
    const validation = (await bills.validateCustomer(userId, {
      billerId: mtn.id,
      productId: mtn.products[0]?.id as string,
      customerReference: '0803 123 4567',
    })) as { id: string; customerReferenceMasked: string };
    expect(validation.customerReferenceMasked).toBe('*******4567');

    const payment = (await bills.create(userId, `it-airtime:${suffix}`, {
      walletId,
      validationId: validation.id,
      customerReference: '+2348031234567',
      amountMinor: '100000',
    })) as { status: string; totalDebitMinor: bigint };
    expect(payment.status).toBe('SUCCESSFUL');
    await expect(
      transactions.run((tx) => ledger.accountBalanceWithin(tx, availableId)),
    ).resolves.toBe(99_000_00n);
  });

  it('charges a cable package at exactly its price', async () => {
    const dstv = await biller('CABLE_TV', 'DSTV');
    const compact = dstv.products.find((product) => product.providerCode === 'DSTV-COMPACT');
    if (!compact?.fixedAmountMinor) throw new Error('DStv Compact is missing');
    const validation = (await bills.validateCustomer(userId, {
      billerId: dstv.id,
      productId: compact.id,
      customerReference: '7020147841',
    })) as { id: string; verifiedCustomerName: string };
    expect(validation.verifiedCustomerName).toBe('Test Customer');

    await expect(
      bills.create(userId, `it-cable-wrong:${suffix}`, {
        walletId,
        validationId: validation.id,
        customerReference: '7020147841',
        amountMinor: '100',
      }),
    ).rejects.toThrow('fixed amount');

    const payment = (await bills.create(userId, `it-cable:${suffix}`, {
      walletId,
      validationId: validation.id,
      customerReference: '7020147841',
      amountMinor: compact.fixedAmountMinor.toString(),
    })) as { status: string };
    expect(payment.status).toBe('SUCCESSFUL');
  });
});
