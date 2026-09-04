import {
  ContributionScheduleStatus,
  PayoutScheduleStatus,
} from '../../../../generated/prisma/enums.js';
import {
  assertContributionAmount,
  canExecutePayout,
  contributionIdempotencyKey,
  contributionScheduleStatusFor,
  isCycleFullyCollected,
  isOutstanding,
  payoutIdempotencyKey,
  poolAccountCode,
} from './ajo-settlement-policy.js';

describe('contributionScheduleStatusFor', () => {
  const dueAt = new Date('2026-10-01T00:00:00.000Z');
  const before = new Date('2026-09-20T00:00:00.000Z');
  const after = new Date('2026-10-05T00:00:00.000Z');

  it('reports PAID once the full amount has been paid', () => {
    const status = contributionScheduleStatusFor({
      amountDueMinor: 500_000n,
      amountPaidMinor: 500_000n,
      dueAt,
      now: before,
    });
    expect(status).toBe(ContributionScheduleStatus.PAID);
  });

  it('reports PAID even past the due date, since the debt is settled', () => {
    const status = contributionScheduleStatusFor({
      amountDueMinor: 500_000n,
      amountPaidMinor: 500_000n,
      dueAt,
      now: after,
    });
    expect(status).toBe(ContributionScheduleStatus.PAID);
  });

  it('reports PARTIALLY_PAID when something but not everything has arrived', () => {
    const status = contributionScheduleStatusFor({
      amountDueMinor: 500_000n,
      amountPaidMinor: 200_000n,
      dueAt,
      now: before,
    });
    expect(status).toBe(ContributionScheduleStatus.PARTIALLY_PAID);
  });

  it('reports DUE when nothing has been paid and the date has not passed', () => {
    const status = contributionScheduleStatusFor({
      amountDueMinor: 500_000n,
      amountPaidMinor: 0n,
      dueAt,
      now: before,
    });
    expect(status).toBe(ContributionScheduleStatus.DUE);
  });

  it('reports OVERDUE when nothing has been paid and the date has passed', () => {
    const status = contributionScheduleStatusFor({
      amountDueMinor: 500_000n,
      amountPaidMinor: 0n,
      dueAt,
      now: after,
    });
    expect(status).toBe(ContributionScheduleStatus.OVERDUE);
  });

  it('does not treat an overpayment as unpaid', () => {
    // The service refuses overpayment, but the status must not be wrong if a
    // row somehow holds one — reporting DUE would re-collect from a member who
    // has already paid.
    const status = contributionScheduleStatusFor({
      amountDueMinor: 500_000n,
      amountPaidMinor: 600_000n,
      dueAt,
      now: before,
    });
    expect(status).toBe(ContributionScheduleStatus.PAID);
  });
});

describe('assertContributionAmount', () => {
  const base = { amountDueMinor: 500_000n, amountPaidMinor: 0n };

  it('accepts the full amount', () => {
    expect(() => assertContributionAmount({ ...base, amountMinor: 500_000n })).not.toThrow();
  });

  it('accepts a part payment', () => {
    expect(() => assertContributionAmount({ ...base, amountMinor: 100_000n })).not.toThrow();
  });

  it('accepts the exact remainder of a part-paid schedule', () => {
    expect(() =>
      assertContributionAmount({
        amountDueMinor: 500_000n,
        amountPaidMinor: 300_000n,
        amountMinor: 200_000n,
      }),
    ).not.toThrow();
  });

  it('refuses zero', () => {
    expect(() => assertContributionAmount({ ...base, amountMinor: 0n })).toThrow(
      /greater than zero/i,
    );
  });

  it('refuses a negative amount, which would credit the member from the pool', () => {
    expect(() => assertContributionAmount({ ...base, amountMinor: -100_000n })).toThrow(
      /greater than zero/i,
    );
  });

  it('refuses more than is still owed rather than trimming it', () => {
    // Quietly keeping the difference in a pool the member cannot withdraw from
    // would be worse than telling them.
    expect(() => assertContributionAmount({ ...base, amountMinor: 600_000n })).toThrow(
      /more than this contribution still owes/i,
    );
  });

  it('refuses anything at all once the schedule is settled', () => {
    expect(() =>
      assertContributionAmount({
        amountDueMinor: 500_000n,
        amountPaidMinor: 500_000n,
        amountMinor: 1n,
      }),
    ).toThrow(/already been paid in full/i);
  });
});

describe('isCycleFullyCollected', () => {
  const paid = { status: ContributionScheduleStatus.PAID };

  it('is true when every schedule is paid', () => {
    expect(isCycleFullyCollected([paid, paid, paid])).toBe(true);
  });

  it('counts a waiver as collected, since it is a recorded decision', () => {
    expect(isCycleFullyCollected([paid, { status: ContributionScheduleStatus.WAIVED }])).toBe(true);
  });

  it('counts a cancelled schedule as collected', () => {
    expect(isCycleFullyCollected([paid, { status: ContributionScheduleStatus.CANCELLED }])).toBe(
      true,
    );
  });

  it.each([
    [ContributionScheduleStatus.PENDING],
    [ContributionScheduleStatus.DUE],
    [ContributionScheduleStatus.PARTIALLY_PAID],
    [ContributionScheduleStatus.OVERDUE],
  ])('is false while any schedule is %s', (status) => {
    // ADR-001 allows no platform float. One member still owing means paying out
    // now would spend a later recipient's turn to fund this one.
    expect(isCycleFullyCollected([paid, paid, { status }])).toBe(false);
  });

  it('is true for a cycle with no schedules at all', () => {
    expect(isCycleFullyCollected([])).toBe(true);
  });

  it('treats a nearly-complete cycle as not collected', () => {
    const schedules = [
      ...Array<{ status: ContributionScheduleStatus }>(99).fill(paid),
      {
        status: ContributionScheduleStatus.PARTIALLY_PAID,
      },
    ];
    expect(isCycleFullyCollected(schedules)).toBe(false);
  });
});

describe('isOutstanding', () => {
  it.each([
    [ContributionScheduleStatus.PAID, false],
    [ContributionScheduleStatus.WAIVED, false],
    [ContributionScheduleStatus.CANCELLED, false],
    [ContributionScheduleStatus.PENDING, true],
    [ContributionScheduleStatus.DUE, true],
    [ContributionScheduleStatus.PARTIALLY_PAID, true],
    [ContributionScheduleStatus.OVERDUE, true],
  ])('reports %s as outstanding=%s', (status, expected) => {
    expect(isOutstanding(status)).toBe(expected);
  });
});

describe('canExecutePayout', () => {
  it('allows a held payout to proceed once arrears are settled', () => {
    expect(canExecutePayout(PayoutScheduleStatus.HELD)).toBe(true);
  });

  it.each([[PayoutScheduleStatus.PENDING], [PayoutScheduleStatus.READY]])('allows %s', (status) => {
    expect(canExecutePayout(status)).toBe(true);
  });

  it.each([
    [PayoutScheduleStatus.PAID],
    [PayoutScheduleStatus.PROCESSING],
    [PayoutScheduleStatus.CANCELLED],
    [PayoutScheduleStatus.FAILED],
  ])('refuses %s, so a replay cannot pay twice', (status) => {
    expect(canExecutePayout(status)).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('scopes a contribution key to its schedule', () => {
    // One client key reused across two contributions must not collapse them
    // into a single settlement.
    expect(contributionIdempotencyKey('schedule-a', 'client-key')).not.toBe(
      contributionIdempotencyKey('schedule-b', 'client-key'),
    );
  });

  it('derives a payout key from the schedule alone', () => {
    // No caller input: a schedule has exactly one payout, so a retried or
    // replayed execution cannot pay a recipient twice whatever it sends.
    expect(payoutIdempotencyKey('schedule-1')).toBe('ajo-payout:schedule-1');
  });

  it('gives different payout schedules different keys', () => {
    expect(payoutIdempotencyKey('schedule-1')).not.toBe(payoutIdempotencyKey('schedule-2'));
  });
});

describe('poolAccountCode', () => {
  it('is stable for a group, so the same account is found again', () => {
    expect(poolAccountCode('group-1')).toBe(poolAccountCode('group-1'));
  });

  it('is distinct per group, so two groups never share a pool', () => {
    expect(poolAccountCode('group-1')).not.toBe(poolAccountCode('group-2'));
  });
});
