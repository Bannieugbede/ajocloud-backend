import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FoodSubscriptionTarget } from './food-subscription.payment-target.js';

const USER = 'user-1';
const SUBSCRIPTION = 'subscription-1';

type Write = { data: Record<string, unknown> };

function build(
  seed: {
    owner?: string;
    status?: string;
    programmeStatus?: string;
    quantity?: number;
    amountPaidMinor?: bigint;
    escrowExists?: boolean;
    missingWallet?: boolean;
  } = {},
) {
  const subscription = {
    id: SUBSCRIPTION,
    groupId: 'programme-1',
    userId: seed.owner ?? USER,
    status: seed.status ?? 'PENDING',
    quantity: seed.quantity ?? 2,
    amountPaidMinor: seed.amountPaidMinor ?? 0n,
    group: { name: 'Family staples', status: seed.programmeStatus ?? 'OPEN' },
    package: { name: 'Rice and beans', priceMinor: 40_000_00n, currency: 'NGN' },
  };
  const client = {
    foodSubscription: {
      findUnique: jest.fn().mockResolvedValue(subscription),
      update: jest.fn<Promise<unknown>, [Write]>().mockResolvedValue({}),
    },
    financialAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue(seed.escrowExists === false ? null : { id: 'escrow-1', isActive: true }),
      findFirst: jest.fn().mockResolvedValue({ id: 'wallet-available-1' }),
      create: jest.fn<Promise<unknown>, [Write]>().mockResolvedValue({ id: 'escrow-new' }),
    },
    wallet: {
      findUnique: jest.fn().mockResolvedValue(seed.missingWallet ? null : { id: 'wallet-1' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const ledger = { postWithin: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
  const target = new FoodSubscriptionTarget(ledger as never);
  return { target, client, ledger };
}

const refund = {
  userId: USER,
  subscriptionId: SUBSCRIPTION,
  programmeId: 'programme-1',
  programmeStatus: 'OPEN',
  amountPaidMinor: 80_000_00n,
  paidAt: new Date('2026-09-20T10:00:00Z'),
  currency: 'NGN',
};

describe('FoodSubscriptionTarget', () => {
  it('is paid in full from the wallet', () => {
    const { target } = build();
    expect(target.methods).toEqual(['WALLET']);
    expect(target.amountRule).toBe('fixed');
  });

  it('charges the package price for every portion', async () => {
    const { target, client } = build({ quantity: 2 });
    const resolved = await target.resolve(client as never, USER, SUBSCRIPTION);
    expect(resolved.amountMinor).toBe(80_000_00n);
    expect(resolved.description).toBe('Food: Family staples, Rice and beans × 2');
  });

  it('reports another member’s enrolment as not found', async () => {
    const { target, client } = build({ owner: 'user-2' });
    await expect(target.resolve(client as never, USER, SUBSCRIPTION)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['an enrolment already paid', { status: 'ACTIVE' }],
    ['a withdrawn enrolment', { status: 'CANCELLED' }],
    ['a finished programme', { programmeStatus: 'COMPLETED' }],
    ['a suspended programme', { programmeStatus: 'SUSPENDED' }],
  ])('refuses %s', async (_label, seed) => {
    const { target, client } = build(seed);
    await expect(target.resolve(client as never, USER, SUBSCRIPTION)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('still takes payment after buying has begun from a member already enrolled', async () => {
    const { target, client } = build({ programmeStatus: 'ACTIVE' });
    await expect(target.resolve(client as never, USER, SUBSCRIPTION)).resolves.toMatchObject({
      amountMinor: 80_000_00n,
    });
  });

  it('opens the programme’s escrow account on its first payment', async () => {
    const { target, client } = build({ escrowExists: false });
    await target.creditAccount(client as never, SUBSCRIPTION, 'NGN');
    const created = client.financialAccount.create.mock.calls[0]?.[0];
    expect(created?.data).toMatchObject({
      code: 'FOOD_PROGRAMME:programme-1:ESCROW',
      purpose: 'FOOD_PROGRAMME_ESCROW',
      type: 'LIABILITY',
    });
  });

  it('activates the enrolment once it is paid in full', async () => {
    const { target, client } = build();
    await target.settle(client as never, {
      userId: USER,
      targetId: SUBSCRIPTION,
      intentId: 'intent-1',
      amountMinor: 80_000_00n,
      feeMinor: 0n,
      currency: 'NGN',
      ledgerTransactionId: 'ledger-1',
    });
    const update = client.foodSubscription.update.mock.calls[0]?.[0];
    expect(update?.data).toMatchObject({ amountPaidMinor: 80_000_00n, status: 'ACTIVE' });
    expect(client.outboxEvent.create).toHaveBeenCalled();
  });

  describe('refunds', () => {
    it('refunds nothing, and posts nothing, when nothing was paid', async () => {
      const { target, client, ledger } = build();
      await expect(
        target.refundWithin(client as never, { ...refund, amountPaidMinor: 0n }),
      ).resolves.toBe(0n);
      expect(ledger.postWithin).not.toHaveBeenCalled();
    });

    it('returns the payment from escrow to the member’s wallet', async () => {
      const { target, client, ledger } = build();
      await expect(target.refundWithin(client as never, refund)).resolves.toBe(80_000_00n);
      const [, posting] = ledger.postWithin.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(posting['entries']).toEqual([
        { accountId: 'escrow-1', direction: 'DEBIT', amountMinor: 80_000_00n },
        { accountId: 'wallet-available-1', direction: 'CREDIT', amountMinor: 80_000_00n },
      ]);
    });

    it('names the refund after the payment it returns, so a retry cannot pay twice', async () => {
      const { target, client, ledger } = build();
      await target.refundWithin(client as never, refund);
      await target.refundWithin(client as never, refund);
      const keys = ledger.postWithin.mock.calls.map(
        ([, posting]) => (posting as { idempotencyKey: string }).idempotencyKey,
      );
      expect(keys[0]).toBe(keys[1]);
    });

    it('refuses once buying has begun', async () => {
      const { target, client, ledger } = build();
      await expect(
        target.refundWithin(client as never, { ...refund, programmeStatus: 'ACTIVE' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ledger.postWithin).not.toHaveBeenCalled();
    });

    it('refuses when there is no wallet to refund to', async () => {
      const { target, client } = build({ missingWallet: true });
      await expect(target.refundWithin(client as never, refund)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });
});
