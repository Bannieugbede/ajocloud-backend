import { firstArg, secondArg } from '../../common/testing/mock-arguments.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { PaymentSettlementService } from './payment-settlement.service.js';

const REFERENCE = 'monnify-ref-1';

function build(intent: Record<string, unknown> | null) {
  const postWithin = jest.fn().mockResolvedValue({ id: 'ledger-1', reference: 'DEP-ABC' });
  const intentUpdate = jest.fn().mockResolvedValue({});
  const tx = {
    paymentIntent: { findUnique: jest.fn().mockResolvedValue(intent), update: intentUpdate },
    wallet: { findFirst: jest.fn().mockResolvedValue({ id: 'wallet-1' }) },
    financialAccount: {
      findFirstOrThrow: jest.fn(({ where }: { where: { purpose: string } }) =>
        Promise.resolve({ id: `account-${where.purpose}` }),
      ),
    },
    auditLog: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
  };
  const prisma = {
    paymentIntent: { findUnique: jest.fn().mockResolvedValue(intent), update: intentUpdate },
  };
  const service = new PaymentSettlementService(
    prisma as unknown as PrismaService,
    {
      serializable: (operation: (client: typeof tx) => unknown) => operation(tx),
    } as unknown as TransactionService,
    { postWithin } as never,
  );
  return { service, prisma, tx, postWithin, intentUpdate };
}

const processing = (overrides: Record<string, unknown> = {}) => ({
  id: 'intent-1',
  userId: 'user-1',
  walletId: 'wallet-1',
  status: 'PROCESSING',
  amountMinor: 1_500_000n,
  feeMinor: 32_500n,
  currency: 'NGN',
  ...overrides,
});

describe('PaymentSettlementService', () => {
  it('credits the wallet net of the fee and debits the provider gross', async () => {
    const { service, postWithin } = build(processing());
    await service.settleSuccessful(REFERENCE);

    const command = secondArg<{
      entries: { accountId: string; direction: string; amountMinor: bigint }[];
    }>(postWithin);
    const byPurpose = (purpose: string) =>
      command.entries.find((entry) => entry.accountId === `account-${purpose}`);

    // Gross to the provider: that is what they actually hold for us.
    expect(byPurpose('PROVIDER_PAYABLE')).toEqual(
      expect.objectContaining({ direction: 'DEBIT', amountMinor: 1_500_000n }),
    );
    // Net to the user, so the credited figure is the balance they will see.
    expect(byPurpose('WALLET_AVAILABLE')).toEqual(
      expect.objectContaining({ direction: 'CREDIT', amountMinor: 1_467_500n }),
    );
    expect(byPurpose('PLATFORM_FEE_REVENUE')).toEqual(
      expect.objectContaining({ direction: 'CREDIT', amountMinor: 32_500n }),
    );
  });

  it('balances the posting', async () => {
    const { service, postWithin } = build(processing());
    await service.settleSuccessful(REFERENCE);
    const command = secondArg<{
      entries: { direction: string; amountMinor: bigint }[];
    }>(postWithin);
    const sum = (direction: string) =>
      command.entries
        .filter((entry) => entry.direction === direction)
        .reduce((total, entry) => total + entry.amountMinor, 0n);
    expect(sum('DEBIT')).toBe(sum('CREDIT'));
  });

  it('omits the fee leg entirely when nothing is charged', async () => {
    const { service, postWithin } = build(processing({ feeMinor: 0n }));
    await service.settleSuccessful(REFERENCE);
    const command = secondArg<{
      entries: { accountId: string }[];
    }>(postWithin);
    // A zero-amount row would be noise in a ledger that is never edited.
    expect(command.entries).toHaveLength(2);
    expect(
      command.entries.some((entry) => entry.accountId === 'account-PLATFORM_FEE_REVENUE'),
    ).toBe(false);
  });

  it('keys the posting off the intent, not the event', async () => {
    const { service, postWithin } = build(processing());
    await service.settleSuccessful(REFERENCE);
    const command = secondArg<{ idempotencyKey: string }>(postWithin);
    // A same-payment event redelivered under a new provider event id must not
    // post a second credit; a duplicate is unrecoverable once it is spent.
    expect(command.idempotencyKey).toBe('payment-settlement:intent-1');
  });

  it('does not post for an intent that already succeeded', async () => {
    const { service, postWithin } = build(processing({ status: 'SUCCEEDED' }));
    await expect(service.settleSuccessful(REFERENCE)).resolves.toEqual({
      status: 'ALREADY_SETTLED',
      intentId: 'intent-1',
    });
    expect(postWithin).not.toHaveBeenCalled();
  });

  it('re-checks status inside the transaction, not only before it', async () => {
    // Two deliveries can both pass the pre-check; only the in-transaction read
    // stops the second one crediting again.
    const { service, tx, postWithin } = build(processing());
    tx.paymentIntent.findUnique.mockResolvedValue(processing({ status: 'SUCCEEDED' }));
    await expect(service.settleSuccessful(REFERENCE)).resolves.toEqual({
      status: 'ALREADY_SETTLED',
      intentId: 'intent-1',
    });
    expect(postWithin).not.toHaveBeenCalled();
  });

  it('reports an unmatched reference rather than guessing', async () => {
    const { service, postWithin } = build(null);
    await expect(service.settleSuccessful(REFERENCE)).resolves.toEqual({ status: 'UNMATCHED' });
    expect(postWithin).not.toHaveBeenCalled();
  });

  it('records a failure without posting anything', async () => {
    const { service, postWithin, intentUpdate } = build(processing());
    await expect(service.settleFailed(REFERENCE, 'Card declined')).resolves.toEqual({
      status: 'FAILED',
      intentId: 'intent-1',
    });
    // No money moved, so nothing belongs in the ledger.
    expect(postWithin).not.toHaveBeenCalled();
    const update = firstArg<{ data: { status: string; failureReason: string } }>(intentUpdate);
    expect(update.data.status).toBe('FAILED');
  });

  it('will not fail a payment that already settled', async () => {
    const { service, intentUpdate } = build(processing({ status: 'SUCCEEDED' }));
    await expect(service.settleFailed(REFERENCE, 'late failure')).resolves.toEqual({
      status: 'ALREADY_SETTLED',
      intentId: 'intent-1',
    });
    // Undoing a posted credit is a reversal, which ADR-010 leaves to
    // reconciliation rather than a status flip.
    expect(intentUpdate).not.toHaveBeenCalled();
  });
});
