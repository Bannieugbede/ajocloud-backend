import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AccountType, FinancialAccountPurpose, UserStatus } from '../generated/prisma/enums.js';
import type { TransactionService } from '../src/infrastructure/database/transaction.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';

const runDatabaseTests =
  process.env.CI === 'true' || process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeWithDatabase = runDatabaseTests ? describe : describe.skip;

describeWithDatabase('financial expansion (PostgreSQL integration)', () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const ledger = new LedgerService({} as TransactionService);

  afterAll(async () => prisma.$disconnect());

  it('reserves wallet funds atomically and deduplicates the ledger command', async () => {
    const rollback = new Error('ROLLBACK_TEST');
    await expect(
      prisma.$transaction(
        async (tx) => {
          const suffix = randomUUID();
          const user = await tx.user.create({
            data: { email: `${suffix}@example.test`, status: UserStatus.ACTIVE },
          });
          const wallet = await tx.wallet.create({ data: { userId: user.id, currency: 'NGN' } });
          const available = await tx.financialAccount.create({
            data: {
              code: `TEST:${suffix}:AVAILABLE`,
              name: 'Available',
              type: AccountType.LIABILITY,
              purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
              currency: 'NGN',
              walletId: wallet.id,
            },
          });
          const reserved = await tx.financialAccount.create({
            data: {
              code: `TEST:${suffix}:RESERVED`,
              name: 'Reserved',
              type: AccountType.LIABILITY,
              purpose: FinancialAccountPurpose.WALLET_RESERVED,
              currency: 'NGN',
              walletId: wallet.id,
            },
          });
          const funding = await tx.financialAccount.create({
            data: {
              code: `TEST:${suffix}:FUNDING`,
              name: 'Funding',
              type: AccountType.ASSET,
              currency: 'NGN',
            },
          });
          await ledger.postWithin(tx, {
            idempotencyKey: `fund:${suffix}`,
            reference: `FUND-${suffix}`,
            description: 'Integration funding',
            currency: 'NGN',
            entries: [
              { accountId: funding.id, direction: 'DEBIT', amountMinor: 10_000n },
              { accountId: available.id, direction: 'CREDIT', amountMinor: 10_000n },
            ],
          });
          const command = {
            idempotencyKey: `reserve:${suffix}`,
            reference: `RESERVE-${suffix}`,
            description: 'Integration reserve',
            currency: 'NGN',
            entries: [
              { accountId: available.id, direction: 'DEBIT' as const, amountMinor: 4_000n },
              { accountId: reserved.id, direction: 'CREDIT' as const, amountMinor: 4_000n },
            ],
          };
          const first = await ledger.postWithin(tx, command);
          const replay = await ledger.postWithin(tx, command);
          expect(replay).toEqual(first);
          expect(await ledger.accountBalanceWithin(tx, available.id)).toBe(6_000n);
          expect(await ledger.accountBalanceWithin(tx, reserved.id)).toBe(4_000n);
          throw rollback;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ).rejects.toBe(rollback);
  });

  it('enforces Bill Payment total-debit integrity in PostgreSQL', async () => {
    const suffix = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: `${suffix}@example.test`, status: UserStatus.ACTIVE },
        });
        const wallet = await tx.wallet.create({ data: { userId: user.id, currency: 'NGN' } });
        const category = await tx.billCategory.create({
          data: {
            provider: 'integration',
            providerCode: suffix,
            name: 'Integration',
            refreshedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        const biller = await tx.billBiller.create({
          data: {
            categoryId: category.id,
            providerCode: suffix,
            name: 'Integration',
            refreshedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        await tx.billPayment.create({
          data: {
            internalReference: `BILL-${suffix}`,
            provider: 'integration',
            idempotencyKey: suffix,
            requestHash: suffix,
            userId: user.id,
            walletId: wallet.id,
            billerId: biller.id,
            customerReferenceDigest: suffix,
            customerReferenceMasked: '***1234',
            amountMinor: 1_000n,
            feeMinor: 100n,
            totalDebitMinor: 1_099n,
            currency: 'NGN',
          },
        });
      }),
    ).rejects.toThrow('violates check constraint "bill_payments_amount_check"');
  });
});
