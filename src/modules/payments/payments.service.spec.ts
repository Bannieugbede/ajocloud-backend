import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';

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
const OTHER_USER = 'user-2';
const INTENT = '11111111-1111-4111-8111-111111111111';
const DUE = '22222222-2222-4222-8222-222222222222';

type Seed = {
  dueOwner?: string;
  dueStatus?: string;
  dueMissing?: boolean;
  dueAmountMinor?: bigint;
  intentStatus?: string;
  intentMissing?: boolean;
  intentAmountMinor?: bigint;
  expiresAt?: Date;
  availableMinor?: bigint;
  feeMinor?: bigint;
  existingIntent?: boolean;
  walletId?: string | null;
  pinThrows?: Error;
};

function build(seed: Seed = {}) {
  const due = seed.dueMissing
    ? null
    : {
        id: DUE,
        status: seed.dueStatus ?? 'PENDING',
        amountMinor: seed.dueAmountMinor ?? 5_000_00n,
        currency: 'NGN',
        pool: { name: 'Class of 2026 dues' },
        member: { userId: seed.dueOwner ?? USER },
      };

  const intent = seed.intentMissing
    ? null
    : {
        id: INTENT,
        userId: USER,
        walletId: seed.walletId === undefined ? 'wallet-1' : seed.walletId,
        status: seed.intentStatus ?? 'REQUIRES_CONFIRMATION',
        targetType: 'AKAWO_POOL_DUE',
        targetId: DUE,
        amountMinor: seed.intentAmountMinor ?? 5_000_00n,
        feeMinor: seed.feeMinor ?? 0n,
        totalMinor: (seed.intentAmountMinor ?? 5_000_00n) + (seed.feeMinor ?? 0n),
        currency: 'NGN',
        method: null,
        expiresAt: seed.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000),
        settledAt: null,
        failureReason: null,
      };

  const calls = {
    intentCreate: jest.fn<WriteResult, [WriteArgs]>(({ data }) => ({
      ...intent,
      ...data,
    })),
    intentUpdate: jest.fn<WriteResult, [WriteArgs]>(({ data }) => ({ ...intent, ...data })),
    dueUpdate: jest.fn<WriteResult, [WriteArgs]>(({ data }) => ({ id: DUE, ...data })),
    postWithin: jest.fn<Promise<PostingResult>, [unknown, PostingCommand]>(() =>
      Promise.resolve({ id: 'ledger-1', reference: 'PAY-ABC' }),
    ),
    verifyPin: jest.fn().mockResolvedValue(undefined),
    audit: jest.fn().mockResolvedValue(undefined),
    assessFee: jest.fn().mockResolvedValue({ amountMinor: 0n, definitionId: null, snapshot: {} }),
  };
  if (seed.pinThrows) calls.verifyPin.mockRejectedValue(seed.pinThrows);

  const accounts = [
    { id: 'available-1', purpose: 'WALLET_AVAILABLE', walletId: 'wallet-1' },
    { id: 'payable-1', purpose: 'PROVIDER_PAYABLE', walletId: null },
    { id: 'fee-1', purpose: 'PLATFORM_FEE_REVENUE', walletId: null },
  ];
  const findAccount = jest.fn(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(accounts.find((a) => a.purpose === where['purpose']) ?? null),
  );

  const tx = {
    paymentIntent: {
      findFirst: jest.fn().mockResolvedValue(intent),
      update: calls.intentUpdate,
    },
    akawoPoolDue: { findUnique: jest.fn().mockResolvedValue(due), update: calls.dueUpdate },
    financialAccount: { findFirst: findAccount },
  };

  const prisma = {
    paymentIntent: {
      findUnique: jest.fn().mockResolvedValue(seed.existingIntent ? intent : null),
      findFirst: jest.fn().mockResolvedValue(intent),
      create: calls.intentCreate,
      update: calls.intentUpdate,
    },
    akawoPoolDue: { findUnique: jest.fn().mockResolvedValue(due) },
    wallet: { findFirst: jest.fn().mockResolvedValue({ id: 'wallet-1', currency: 'NGN' }) },
    user: { findUnique: jest.fn().mockResolvedValue({ email: 'member@example.test' }) },
    financialAccount: { findFirst: findAccount },
    ledgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const service = new PaymentsService(
    prisma as never,
    { serializable: (fn: (t: unknown) => unknown) => fn(tx) } as never,
    {
      postWithin: calls.postWithin,
      accountBalanceWithin: jest.fn().mockResolvedValue(seed.availableMinor ?? 10_000_00n),
    } as never,
    { verifyPin: calls.verifyPin } as never,
    { record: calls.audit } as never,
    // Fees are resolved from the database; the default here charges nothing so
    // existing expectations describe the amount alone.
    { assess: calls.assessFee } as never,
    {
      name: 'mock',
      createTransferCharge: jest.fn().mockResolvedValue({
        providerReference: 'mock-ref',
        transferInstructions: { accountNumber: '9999000001' },
      }),
      createCardCharge: jest
        .fn()
        .mockResolvedValue({ providerReference: 'mock-ref', checkoutUrl: 'https://x.invalid' }),
    } as never,
  );

  return { service, calls, prisma, tx };
}

const confirmWallet = { method: 'WALLET', transactionPin: '1234' } as never;

describe('create', () => {
  it('resolves the amount from the due rather than trusting the caller', async () => {
    const { service, calls } = build({ dueAmountMinor: 7_500_00n });

    await service.create(USER, { targetType: 'AKAWO_POOL_DUE', targetId: DUE } as never, 'key-1');

    const { data } = firstWrite(calls.intentCreate);
    expect(data['amountMinor']).toBe(7_500_00n);
  });

  it('refuses a due belonging to another member, without revealing it exists', async () => {
    const { service } = build({ dueOwner: OTHER_USER });
    // NotFound, not Forbidden: a Forbidden here would confirm the due's
    // existence and leak its amount to anyone who guessed an id.
    await expect(
      service.create(USER, { targetType: 'AKAWO_POOL_DUE', targetId: DUE } as never, 'key-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a due that is already settled', async () => {
    const { service } = build({ dueStatus: 'PAID' });
    await expect(
      service.create(USER, { targetType: 'AKAWO_POOL_DUE', targetId: DUE } as never, 'key-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the original intent for a repeated idempotency key', async () => {
    const { service, calls } = build({ existingIntent: true });

    const result = await service.create(
      USER,
      { targetType: 'AKAWO_POOL_DUE', targetId: DUE } as never,
      'key-1',
    );

    expect(result.id).toBe(INTENT);
    // The point of idempotency: a retried tap must not create a second payment.
    expect(calls.intentCreate).not.toHaveBeenCalled();
  });

  it('charges no fee while the band model is undecided, and says so', async () => {
    const { service } = build();
    const result = await service.create(
      USER,
      { targetType: 'AKAWO_POOL_DUE', targetId: DUE } as never,
      'key-1',
    );
    expect(result.feeMinor).toBe('0');
    expect(result.totalMinor).toBe(result.amountMinor);
  });

  it('serialises money as strings so no amount is rounded through a Number', async () => {
    const { service } = build({ dueAmountMinor: 12_345_678_901_234_567_890n });
    const result = await service.create(
      USER,
      { targetType: 'AKAWO_POOL_DUE', targetId: DUE } as never,
      'key-1',
    );
    expect(result.amountMinor).toBe('12345678901234567890');
  });

  it.each(['AJO_CONTRIBUTION', 'FOOD_SUBSCRIPTION', 'WALLET_TOPUP'])(
    'refuses %s explicitly rather than creating an unpayable intent',
    async (targetType) => {
      const { service } = build();
      await expect(
        service.create(USER, { targetType, targetId: DUE } as never, 'key-1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    },
  );
});

describe('confirm by wallet', () => {
  it('debits the wallet and credits the destination for the same total', async () => {
    const { service, calls } = build();

    await service.confirm(USER, INTENT, confirmWallet, 'key-2');

    const posting = firstPosting(calls.postWithin);
    const debits = posting.entries.filter((e) => e.direction === 'DEBIT');
    const credits = posting.entries.filter((e) => e.direction === 'CREDIT');
    const sum = (rows: readonly PostingEntry[]) =>
      rows.reduce((total, row) => total + row.amountMinor, 0n);
    // Double entry: the posting must balance or the ledger is corrupt.
    expect(sum(debits)).toBe(sum(credits));
    expect(sum(debits)).toBe(5_000_00n);
  });

  it('omits the fee leg entirely when no fee is charged', async () => {
    const { service, calls } = build();
    await service.confirm(USER, INTENT, confirmWallet, 'key-2');
    const posting = firstPosting(calls.postWithin);
    // A zero-amount fee entry would still be a ledger row, and a balanced
    // posting must not carry meaningless lines.
    expect(posting.entries.some((e) => e.accountId === 'fee-1')).toBe(false);
  });

  it('marks the due paid and records the ledger transaction that paid it', async () => {
    const { service, calls } = build();

    await service.confirm(USER, INTENT, confirmWallet, 'key-2');

    const { data } = firstWrite(calls.dueUpdate);
    expect(data['status']).toBe('PAID');
    // ADR-007: PAID is only reachable with settled ledger movement behind it.
    expect(data['ledgerTransactionId']).toBe('ledger-1');
  });

  it('refuses when the wallet cannot cover the total', async () => {
    const { service, calls } = build({ availableMinor: 4_999_99n });

    await expect(service.confirm(USER, INTENT, confirmWallet, 'key-2')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(calls.dueUpdate).not.toHaveBeenCalled();
  });

  it('allows a balance that exactly covers the total', async () => {
    const { service, calls } = build({ availableMinor: 5_000_00n });
    await service.confirm(USER, INTENT, confirmWallet, 'key-2');
    expect(calls.dueUpdate).toHaveBeenCalled();
  });

  it('refuses an expired intent rather than settling a stale amount', async () => {
    const { service, calls } = build({ expiresAt: new Date(Date.now() - 1) });

    await expect(service.confirm(USER, INTENT, confirmWallet, 'key-2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it('refuses if the due amount changed after the intent was created', async () => {
    // The organiser corrected the amount mid-flow: paying the old figure would
    // settle a due for the wrong money.
    const { service, calls } = build({ intentAmountMinor: 5_000_00n, dueAmountMinor: 9_000_00n });

    await expect(service.confirm(USER, INTENT, confirmWallet, 'key-2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it('does not settle twice when the same confirmation is retried', async () => {
    const { service, calls } = build({ intentStatus: 'SUCCEEDED' });

    await service.confirm(USER, INTENT, confirmWallet, 'key-2');

    expect(calls.postWithin).not.toHaveBeenCalled();
    expect(calls.dueUpdate).not.toHaveBeenCalled();
  });

  it('verifies the PIN before moving any money', async () => {
    const { service, calls } = build({ pinThrows: new Error('wrong pin') });

    await expect(service.confirm(USER, INTENT, confirmWallet, 'key-2')).rejects.toThrow(
      'wrong pin',
    );
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it('leaves the intent payable after a wrong PIN, so a typo is not fatal', async () => {
    const { service, calls } = build({ pinThrows: new Error('wrong pin') });

    await expect(service.confirm(USER, INTENT, confirmWallet, 'key-2')).rejects.toThrow();

    // The intent must not have transitioned: the user retypes the PIN rather
    // than starting the payment over.
    expect(calls.intentUpdate).not.toHaveBeenCalled();
  });

  it('refuses to settle another user’s intent', async () => {
    const { service, prisma, calls } = build();
    prisma.paymentIntent.findFirst.mockResolvedValue(null);

    await expect(
      service.confirm(OTHER_USER, INTENT, confirmWallet, 'key-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(calls.postWithin).not.toHaveBeenCalled();
  });

  it('refuses when no wallet exists for the currency', async () => {
    const { service } = build({ walletId: null });
    await expect(service.confirm(USER, INTENT, confirmWallet, 'key-2')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('refuses to settle when the due changed after the intent was created', async () => {
    // Behavioural proof that the target is resolved again inside the
    // settlement transaction: resolving only at create time would let a due
    // change between the two steps and still settle at the stale amount.
    const { service, tx } = build({});
    tx.akawoPoolDue.findUnique.mockResolvedValue({
      id: DUE,
      amountMinor: 9_999_00n,
      currency: 'NGN',
      status: 'PENDING',
      pool: { name: 'Class of 2019', organiserUserId: 'organiser' },
      member: { userId: USER },
    });

    await expect(service.confirm(USER, INTENT, confirmWallet, 'key-3')).rejects.toThrow(
      /amount changed/i,
    );
  });
});

describe('confirm by an external rail', () => {
  it.each(['TRANSFER', 'CARD'])(
    'leaves a %s payment PROCESSING, never succeeded',
    async (method) => {
      const { service, calls } = build();

      const result = await service.confirm(
        USER,
        INTENT,
        { method, transactionPin: '1234' } as never,
        'key-2',
      );

      // ADR-006: only a signature-verified webhook may complete an external
      // payment. Returning SUCCEEDED here would credit on the client's word.
      expect(result.status).toBe('PROCESSING');
      expect(calls.dueUpdate).not.toHaveBeenCalled();
    },
  );

  it('returns transfer instructions the payer can act on', async () => {
    const { service } = build();
    const result = await service.confirm(
      USER,
      INTENT,
      { method: 'TRANSFER', transactionPin: '1234' } as never,
      'key-2',
    );
    expect(result.transferInstructions).toEqual({ accountNumber: '9999000001' });
  });
});

describe('source guarantees', () => {
  const source = readFileSync(join(__dirname, 'payments.service.ts'), 'utf8');

  it('never takes a fee or total from the request body', () => {
    // A client-supplied fee or total would let a payer decide what the platform
    // earns. Guarded in source because a behavioural test would not catch a
    // field added later until it was already exploitable.
    expect(source).not.toMatch(/dto\.(feeMinor|totalMinor)/);
  });

  it('accepts a client amount only for a wallet top-up', () => {
    // A top-up is the sole target with no row to read an amount from. Every
    // other target must read its own, so a payer cannot settle a large due for
    // one naira.
    // One line, so there is a single controlled entry point for a client
    // amount rather than several places to keep in step.
    const amountLines = source.split('\n').filter((line) => line.includes('dto.amountMinor'));
    expect(amountLines).toHaveLength(1);
    expect(source).toMatch(/WALLET_TOPUP[\s\S]*?requestedAmountMinor/);
  });
});
