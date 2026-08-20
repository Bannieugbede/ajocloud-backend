import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Monnify webhook signature verification.
 *
 * Monnify signs the raw request body with HMAC-SHA512 keyed on the merchant
 * secret and sends the hex digest in the `monnify-signature` header.
 *
 * Everything here operates on the exact bytes received. A signature recomputed
 * over a parsed-and-re-serialized body is not a signature over what was signed:
 * key order, whitespace, and number formatting all differ. Passing a `Buffer`
 * rather than a string is deliberate for the same reason.
 */

export const MONNIFY_SIGNATURE_HEADER = 'monnify-signature';

/** Rejects events older than this, so a captured delivery cannot be replayed. */
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1_000;

/** Hex digest of an HMAC-SHA512 over the raw body. */
export function computeMonnifySignature(rawBody: Buffer, secret: string): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time signature comparison.
 *
 * Returns false rather than throwing for every rejection reason, so a caller
 * cannot accidentally distinguish "malformed" from "wrong" and leak that
 * distinction to an attacker probing the endpoint.
 */
export function verifyMonnifySignature(
  rawBody: Buffer,
  suppliedSignature: string | undefined,
  secret: string,
): boolean {
  if (!suppliedSignature || !secret) return false;

  const expected = computeMonnifySignature(rawBody, secret);
  // Compare as lower-case hex so a provider that changes digest casing does not
  // silently fail every delivery.
  const supplied = suppliedSignature.trim().toLowerCase();
  if (supplied.length !== expected.length) return false;

  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  // Length is already equal, but timingSafeEqual throws on mismatch, and a
  // thrown error would be a timing signal of its own.
  if (suppliedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}

/**
 * Whether an event's own timestamp is recent enough to act on.
 *
 * A missing or unparseable timestamp is accepted: not every Monnify event
 * carries one, and rejecting those would drop legitimate traffic. Replay
 * protection does not rest on this — the unique constraint on
 * `(provider, providerEventId)` is what makes redelivery a no-op.
 */
export function isWithinTimestampTolerance(
  timestamp: string | undefined,
  now: number,
  toleranceMs: number = WEBHOOK_TIMESTAMP_TOLERANCE_MS,
): boolean {
  if (!timestamp) return true;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return true;
  // Tolerate small forward clock skew as well as age.
  return Math.abs(now - parsed) <= toleranceMs;
}
