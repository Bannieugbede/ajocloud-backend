import { createHmac, randomBytes } from 'node:crypto';

/**
 * The stored form of an invitation code.
 *
 * HMAC rather than a bare hash: the pepper lives outside the database, so a
 * leaked table cannot be brute-forced back into working invitation links. A
 * plain SHA-256 of a code would be, since the code alphabet is known.
 *
 * Issuing and redeeming must agree on this exactly — a mismatch makes every new
 * invitation unredeemable — so both sides call this one function rather than
 * each hashing for themselves.
 */
export function digestInvitationCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

/** A fresh invitation code. 256 bits, so it cannot usefully be guessed. */
export function generateInvitationCode(): string {
  return randomBytes(32).toString('base64url');
}
