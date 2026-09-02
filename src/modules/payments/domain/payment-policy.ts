import type { PaymentIntentStatus, PaymentMethod } from '../../../../generated/prisma/enums.js';

/**
 * How long an unconfirmed intent stays payable.
 *
 * The amount is resolved when the intent is created, so a stale intent could
 * otherwise settle a figure the target no longer has — an organiser who
 * corrected a due amount would still be paid the old one.
 */
export const INTENT_TTL_MS = 15 * 60 * 1000;

/** An intent may only be confirmed while it is still awaiting confirmation. */
export function isConfirmable(status: PaymentIntentStatus): boolean {
  return status === 'REQUIRES_CONFIRMATION';
}

/**
 * A confirmable intent that has not timed out.
 *
 * Expiry is compared against a caller-supplied `now` rather than read from the
 * clock here, so the check is deterministic in tests and so a single request
 * cannot see time move between two of its own checks.
 */
export function isPayable(status: PaymentIntentStatus, expiresAt: Date, now: Date): boolean {
  return isConfirmable(status) && expiresAt.getTime() > now.getTime();
}

/** Terminal states never change again, so polling them is pointless. */
export function isTerminal(status: PaymentIntentStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * Whether settlement completes within the request.
 *
 * Only a wallet payment does: it moves money between two accounts in our own
 * ledger. Transfer and card payments depend on a provider, and per ADR-006 the
 * only trusted signal that one completed is a verified webhook - never the
 * client returning from a checkout page.
 */
export function settlesSynchronously(method: PaymentMethod): boolean {
  return method === 'WALLET';
}

/**
 * The total charged for a payment.
 *
 * Kept as a named function even though the fee is currently always zero, so the
 * call site reads as a deliberate total rather than an amount that happens to be
 * used twice, and so the banded model lands in exactly one place.
 */
export function totalFor(amountMinor: bigint, feeMinor: bigint): bigint {
  return amountMinor + feeMinor;
}

/**
 * The platform fee for a payment.
 *
 * Deliberately zero: the banded fee model in
 * `docs/open-questions/platform-fee-model.md` is not decided. Its boundaries are
 * ambiguous at every threshold ("up to ₦10,000" then "from ₦10,000" overlap at
 * exactly ₦10,000), and guessing one would be a money bug that only surfaces in
 * reconciliation.
 *
 * Returning an explicit zero, rather than omitting the concept, keeps the fee
 * visible in the API and the ledger so it cannot be silently forgotten.
 */
export function feeFor(amountMinor: bigint): bigint {
  // Referenced so the parameter documents the signature the banded model needs,
  // without the linter treating it as dead.
  void amountMinor;
  return 0n;
}

/** A payment must move a positive amount. */
export function isPayableAmount(amountMinor: bigint): boolean {
  return amountMinor > 0n;
}

/** Whether the wallet can cover the total, used to offer or refuse the method. */
export function canPayFromWallet(availableMinor: bigint, totalMinor: bigint): boolean {
  return availableMinor >= totalMinor;
}
