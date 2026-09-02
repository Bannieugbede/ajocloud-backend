import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { WalletMovementsService } from './wallet-movements.service.js';

type WriteArgs = { where?: unknown; data: Record<string, unknown> };
type WriteResult = Record<string, unknown>;

function firstWrite(mock: jest.Mock<WriteResult, [WriteArgs]>): WriteArgs {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('Expected the write to have been called, but it was not');
  return call[0];
}

interface PostingEntry {
  readonly accountId: string;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountMinor: bigint;
}
interface PostingCommand {
  readonly entries: readonly PostingEntry[];
}
interface PostingResult {
  readonly id: string;
  readonly reference: string;
}

/** The posting the ledger was asked to make, failing loudly if none was. */
function firstPosting(
  mock: jest.Mock<Promise<PostingResult>, [unknown, PostingCommand]>,
): PostingCommand {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('Expected a ledger posting, but none was made');
  return call[1];
}

const USER = 'user-1';
const WALLET = 'wallet-1';

type Seed = {
  balanceMinor?: bigint;
  existingTransfer?: boolean;
  recipientMissing?: boolean;
  sourceMissing?: boolean;
  bankAccountMissing?: boolean;
  pinThrows?: Error;
  settleThrows?: Error;
};

function build(seed: Seed = {}) {
  const transferRow = { id: 'transfer-1', amountMinor: 5_000_00n, currency: 'NGN' };
  const withdrawalRow = { id: 'withdrawal-1', amountMinor: 5_000_00n, currency: 'NGN' };

  const calls = {
    transferCreate: jest.fn<WriteResult, [WriteArgs]>(({ data }) => ({ ...transferRow, ...data })),
    withdrawalCreate: jest.fn<WriteResult, [WriteArgs]>(({ data }) => ({
      ...withdrawalRow,
      ...data,
    })),
    postWithin: jest.fn<Promise<PostingResult>, [unknown, PostingCommand]>(() =>
      Promise.resolve({ id: 'ledger-1', reference: 'SEND-1' }),
    ),
    verifyPin: jest.fn().mockResolvedValue(undefined),
    audit: jest.fn().mockResolvedValue(undefined),
  };
  if (seed.pinThrows) calls.verifyPin.mockRejectedValue(seed.pinThrows);

  const account = { id: 'available-1' };
  const tx = {
    transfer: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: seed.settleThrows
        ? jest.fn().mockRejectedValue(seed.settleThrows)
        : calls.transferCreate,
    },
    withdrawal: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: calls.withdrawalCreate,
    },
    wallet: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          seed.sourceMissing ? null : { id: WALLET, currency: 'NGN', status: 'ACTIVE' },
        ),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(seed.recipientMissing ? null : { id: 'user-2' }),
    },
    linkedBankAccount: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          seed.bankAccountMissing
            ? null
            : { id: 'bank-1', accountMasked: '******0001', bankName: 'Test Bank' },
        ),
    },
    financialAccount: { findFirst: jest.fn().mockResolvedValue(account) },
  };
  // The destination wallet lookup is the second wallet.findFirst call.
  tx.wallet.findFirst
    .mockResolvedValueOnce(
      seed.sourceMissing ? null : { id: WALLET, currency: 'NGN', status: 'ACTIVE' },
    )
    .mockResolvedValue({ id: 'wallet-2', currency: 'NGN', status: 'ACTIVE' });

  const prisma = {
    transfer: {
      findUnique: jest.fn().mockResolvedValue(seed.existingTransfer ? transferRow : null),
    },
    withdrawal: { findUnique: jest.fn().mockResolvedValue(null) },
    wallet: { findMany: jest.fn().mockResolvedValue([{ id: WALLET }]) },
  };

  const service = new WalletMovementsService(
    prisma as never,
    { serializable: (fn: (t: unknown) => unknown) => fn(tx) } as never,
    {
      postWithin: calls.postWithin,
      accountBalanceWithin: jest.fn().mockResolvedValue(seed.balanceMinor ?? 100_000_00n),
    } as never,
    { verifyPin: calls.verifyPin } as never,
    { record: calls.audit } as never,
  );
  return { service, calls, prisma, tx };
}

const sendDto = {
  sourceWalletId: WALLET,
  recipientEmail: 'other@example.test',
  amountMinor: '500000',
  transactionPin: '1357',
};

describe('send', () => {
  it('posts a balanced debit and credit for the amount', async () => {
    const { service, calls } = build();
    await service.send(USER, sendDto as never, 'key-1');

    const posting = firstPosting(calls.postWithin);
    const sum = (d: 'DEBIT' | 'CREDIT') =>
      posting.entries.filter((e) => e.direction === d).reduce((t, e) => t + e.amountMinor, 0n);
    expect(sum('DEBIT')).toBe(sum('CREDIT'));
    expect(sum('DEBIT')).toBe(500_000n);
  });

  it('verifies the PIN before moving any money', async () => {
    const { service, calls } = build({ pinThrows: new Error('wrong pin') });
    await expect(service.send(USER, sendDto as never, 'key-1')).rejects.toThrow('wrong pin');
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it('refuses an amount the wallet cannot cover', async () => {
    const { service, calls } = build({ balanceMinor: 499_999n });
    await expect(service.send(USER, sendDto as never, 'key-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it.each([0n, -1n])('refuses a non-positive amount of %s', async (amount) => {
    const { service } = build();
    await expect(
      service.send(USER, { ...sendDto, amountMinor: amount.toString() } as never, 'key-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('returns the original transfer for a repeated idempotency key', async () => {
    const { service, calls } = build({ existingTransfer: true });
    const result = (await service.send(USER, sendDto as never, 'key-1')) as { id: string };
    expect(result.id).toBe('transfer-1');
    // The point of idempotency: a retried tap must not send twice.
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it('returns the winner when a concurrent request lost the idempotency race', async () => {
    // Two taps can pass their in-transaction check at once; the unique
    // constraint rejects the loser, whose work was in fact already done.
    const { service, prisma } = build({ settleThrows: new Error('unique constraint') });
    prisma.transfer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'transfer-1', amountMinor: 5_000_00n, currency: 'NGN' });

    const result = (await service.send(USER, sendDto as never, 'key-1')) as { id: string };
    expect(result.id).toBe('transfer-1');
  });

  it('rethrows a genuine failure rather than hiding it as a race', async () => {
    const { service, prisma } = build({ settleThrows: new Error('database is on fire') });
    prisma.transfer.findUnique.mockResolvedValue(null);
    await expect(service.send(USER, sendDto as never, 'key-1')).rejects.toThrow(
      'database is on fire',
    );
  });

  it('gives the same answer for an unknown recipient as for a missing wallet', async () => {
    // A distinct message would let anyone test whether an email has an account.
    const { service } = build({ recipientMissing: true });
    await expect(service.send(USER, sendDto as never, 'key-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serialises money as strings so no amount is rounded through a Number', async () => {
    const { service } = build();
    const result = (await service.send(USER, sendDto as never, 'key-1')) as { amountMinor: string };
    expect(typeof result.amountMinor).toBe('string');
  });
});

const withdrawDto = {
  walletId: WALLET,
  bankAccountId: 'bank-1',
  amountMinor: '500000',
  transactionPin: '1357',
};

describe('withdraw', () => {
  it('reserves the funds rather than sending them', async () => {
    const { service, calls } = build();
    await service.withdraw(USER, withdrawDto as never, 'key-2');

    const { data } = firstWrite(calls.withdrawalCreate);
    // PENDING, not SUCCEEDED: the bank rail is not operated here yet, so an
    // operator has to release it.
    expect(data['status']).toBe('PENDING');
    expect(calls.postWithin).toHaveBeenCalled();
  });

  it('refuses a bank account that is not the caller’s', async () => {
    const { service, calls } = build({ bankAccountMissing: true });
    await expect(service.withdraw(USER, withdrawDto as never, 'key-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it('refuses more than the wallet holds', async () => {
    const { service, calls } = build({ balanceMinor: 1n });
    await expect(service.withdraw(USER, withdrawDto as never, 'key-2')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it('verifies the PIN before reserving anything', async () => {
    const { service, calls } = build({ pinThrows: new Error('wrong pin') });
    await expect(service.withdraw(USER, withdrawDto as never, 'key-2')).rejects.toThrow(
      'wrong pin',
    );
    expect(calls.postWithin).not.toHaveBeenCalled();
  });
});

describe('source guarantees', () => {
  const source = readFileSync(join(__dirname, 'wallet-movements.service.ts'), 'utf8');

  it('never marks a withdrawal succeeded', () => {
    // Only an operator releasing the payout may do that, and no code path here
    // should be able to short-circuit it.
    expect(source).not.toMatch(/WithdrawalStatus\.SUCCEEDED/);
  });

  it('never logs or persists the transaction PIN', () => {
    expect(source).not.toMatch(/transactionPin['"]?\s*[,:]/);
  });
});
