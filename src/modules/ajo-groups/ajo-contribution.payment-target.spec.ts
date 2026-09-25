import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AjoContributionTarget } from './ajo-contribution.payment-target.js';

const USER = 'user-1';
const SCHEDULE = 'schedule-1';

function build(
  seed: {
    status?: string;
    amountDueMinor?: bigint;
    amountPaidMinor?: bigint;
    memberStatus?: string;
    slotHolder?: string;
    missing?: boolean;
  } = {},
) {
  const schedule = seed.missing
    ? null
    : {
        id: SCHEDULE,
        groupId: 'group-1',
        slotId: 'slot-1',
        amountDueMinor: seed.amountDueMinor ?? 10_000_00n,
        amountPaidMinor: seed.amountPaidMinor ?? 0n,
        currency: 'NGN',
        dueAt: new Date('2026-10-01T00:00:00Z'),
        status: seed.status ?? 'DUE',
        slot: { memberId: seed.slotHolder ?? 'member-1' },
        group: { name: 'Class of 2026' },
        cycle: { sequence: 3 },
      };
  const client = {
    contributionSchedule: { findUnique: jest.fn().mockResolvedValue(schedule) },
    ajoGroupMember: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'member-1', status: seed.memberStatus ?? 'ACTIVE' }),
    },
  };
  const settlement = {
    poolAccountWithin: jest.fn().mockResolvedValue({ id: 'pool-1' }),
    recordContributionWithin: jest.fn().mockResolvedValue({ id: 'contribution-1' }),
  };
  const target = new AjoContributionTarget(settlement as never);
  return { target, client, settlement };
}

describe('AjoContributionTarget', () => {
  it('is paid from the wallet, and may be paid in part', () => {
    const { target } = build();
    expect(target.methods).toEqual(['WALLET']);
    expect(target.amountRule).toBe('partial');
  });

  it('charges what is still owed and names the group and round', async () => {
    const { target, client } = build({ amountPaidMinor: 4_000_00n });
    const resolved = await target.resolve(client as never, USER, SCHEDULE, null);
    expect(resolved.amountMinor).toBe(6_000_00n);
    expect(resolved.description).toBe('Ajo: Class of 2026, round 3');
  });

  it('accepts part of what is owed', async () => {
    const { target, client } = build();
    const resolved = await target.resolve(client as never, USER, SCHEDULE, 2_500_00n);
    expect(resolved.amountMinor).toBe(2_500_00n);
  });

  it('refuses more than is owed', async () => {
    const { target, client } = build({ amountPaidMinor: 9_000_00n });
    await expect(target.resolve(client as never, USER, SCHEDULE, 2_000_00n)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it.each([
    ['another member’s slot', { slotHolder: 'member-2' }],
    ['an inactive member', { memberStatus: 'REMOVED' }],
    ['a missing schedule', { missing: true }],
  ])('reports %s as not found, so it cannot be probed', async (_label, seed) => {
    const { target, client } = build(seed);
    await expect(target.resolve(client as never, USER, SCHEDULE, null)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each(['PAID', 'WAIVED', 'CANCELLED'])('refuses a %s contribution', async (status) => {
    const { target, client } = build({ status });
    await expect(target.resolve(client as never, USER, SCHEDULE, null)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('credits the group’s own pool, the account payouts are made from', async () => {
    const { target, client, settlement } = build();
    const account = await target.creditAccount(client as never, SCHEDULE, 'NGN');
    expect(account).toEqual({ id: 'pool-1' });
    expect(settlement.poolAccountWithin).toHaveBeenCalledWith(client, 'group-1', 'NGN');
  });

  it('records the contribution under a key derived from the payment', async () => {
    const { target, client, settlement } = build();
    await target.settle(client as never, {
      userId: USER,
      targetId: SCHEDULE,
      intentId: 'intent-1',
      amountMinor: 2_500_00n,
      currency: 'NGN',
      ledgerTransactionId: 'ledger-1',
    });
    expect(settlement.recordContributionWithin).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        memberId: 'member-1',
        amountMinor: 2_500_00n,
        ledgerTransactionId: 'ledger-1',
        // A retried confirmation cannot write a second contribution row.
        idempotencyKey: `ajo-contribution:${SCHEDULE}:intent:intent-1`,
      }),
    );
  });

  it('still describes a contribution that has since been paid', async () => {
    const { target, client } = build({ status: 'PAID' });
    await expect(target.describe(client as never, SCHEDULE)).resolves.toBe(
      'Ajo: Class of 2026, round 3',
    );
  });
});
