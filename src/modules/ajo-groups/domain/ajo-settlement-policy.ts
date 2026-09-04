import {
  ContributionScheduleStatus,
  PayoutScheduleStatus,
} from '../../../../generated/prisma/enums.js';

/** The ledger account code holding one group's pooled contributions. */
export function poolAccountCode(groupId: string): string {
  return `AJO_GROUP:${groupId}:POOL`;
}

/**
 * Contribution schedule states that still owe money.
 *
 * `WAIVED` is absent deliberately: a waiver is an accountable decision that the
 * money will not arrive, so the cycle is settled even though nothing was paid.
 * `CANCELLED` is absent for the same reason.
 */
const OUTSTANDING: ReadonlySet<ContributionScheduleStatus> = new Set([
  ContributionScheduleStatus.PENDING,
  ContributionScheduleStatus.DUE,
  ContributionScheduleStatus.PARTIALLY_PAID,
  ContributionScheduleStatus.OVERDUE,
]);

export function isOutstanding(status: ContributionScheduleStatus): boolean {
  return OUTSTANDING.has(status);
}

/**
 * The state a contribution schedule should hold given what has been paid.
 *
 * Derived from the amounts rather than set by whoever wrote the last
 * contribution, so a schedule cannot claim to be paid while it is short, or sit
 * unpaid after the final instalment lands.
 */
export function contributionScheduleStatusFor(input: {
  readonly amountDueMinor: bigint;
  readonly amountPaidMinor: bigint;
  readonly dueAt: Date;
  readonly now: Date;
}): ContributionScheduleStatus {
  if (input.amountPaidMinor >= input.amountDueMinor) return ContributionScheduleStatus.PAID;
  if (input.amountPaidMinor > 0n) return ContributionScheduleStatus.PARTIALLY_PAID;
  return input.now >= input.dueAt
    ? ContributionScheduleStatus.OVERDUE
    : ContributionScheduleStatus.DUE;
}

/**
 * How much of a contribution may be accepted.
 *
 * Overpayment is refused rather than trimmed: a member who sends more than they
 * owe has misunderstood something, and quietly keeping the difference in a pool
 * they cannot withdraw from would be worse than telling them.
 */
export function assertContributionAmount(input: {
  readonly amountMinor: bigint;
  readonly amountDueMinor: bigint;
  readonly amountPaidMinor: bigint;
}): void {
  if (input.amountMinor <= 0n) {
    throw new Error('A contribution must be greater than zero');
  }
  const remaining = input.amountDueMinor - input.amountPaidMinor;
  if (remaining <= 0n) {
    throw new Error('This contribution has already been paid in full');
  }
  if (input.amountMinor > remaining) {
    throw new Error('That is more than this contribution still owes');
  }
}

/**
 * Whether a cycle has collected everything it is owed.
 *
 * ADR-001 allows no platform float, so a payout may only be made from money the
 * cycle actually holds. This is stricter than checking the pool covers the
 * amount: the pool could cover this recipient while another member still owes,
 * and paying then spends a later recipient's turn to fund this one.
 */
export function isCycleFullyCollected(
  schedules: readonly { readonly status: ContributionScheduleStatus }[],
): boolean {
  return schedules.every((schedule) => !isOutstanding(schedule.status));
}

/** Payout schedule states from which execution may still be attempted. */
const EXECUTABLE: ReadonlySet<PayoutScheduleStatus> = new Set([
  PayoutScheduleStatus.PENDING,
  PayoutScheduleStatus.READY,
  PayoutScheduleStatus.HELD,
]);

/**
 * Whether a payout schedule can be executed at all.
 *
 * `HELD` is included: a hold is a cycle waiting on arrears, and settling them is
 * exactly what should let it proceed. `PAID` and `PROCESSING` are excluded, so a
 * replayed request cannot pay a second time even before idempotency is reached.
 */
export function canExecutePayout(status: PayoutScheduleStatus): boolean {
  return EXECUTABLE.has(status);
}

/** Idempotency key for a contribution. Scoped to the schedule it settles. */
export function contributionIdempotencyKey(scheduleId: string, callerKey: string): string {
  return `ajo-contribution:${scheduleId}:${callerKey}`;
}

/**
 * Idempotency key for a payout.
 *
 * Derived entirely from the schedule, with no caller input: a payout schedule
 * has exactly one payout, so a retried, duplicated or replayed execution cannot
 * pay a recipient twice whatever the caller sends.
 */
export function payoutIdempotencyKey(payoutScheduleId: string): string {
  return `ajo-payout:${payoutScheduleId}`;
}
