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
 * Kept as a named function so the call site reads as a deliberate total rather
 * than an amount that happens to be used twice. The fee itself is resolved by
 * `FeesService` from versioned definitions (ADR-009), not computed here.
 */
export function totalFor(amountMinor: bigint, feeMinor: bigint): bigint {
  return amountMinor + feeMinor;
}

/**
 * The smallest deposit the platform accepts.
 *
 * Cost-plus pricing is regressive at very small amounts — a ₦100 deposit would
 * be charged over half of itself — so a floor is a product requirement rather
 * than a fee rule, and ADR-009 records it as one.
 */
export const MINIMUM_DEPOSIT_MINOR = 50_000n;

/** A payment must move a positive amount. */
export function isPayableAmount(amountMinor: bigint): boolean {
  return amountMinor > 0n;
}

/** Whether the wallet can cover the total, used to offer or refuse the method. */
export function canPayFromWallet(availableMinor: bigint, totalMinor: bigint): boolean {
  return availableMinor >= totalMinor;
}
