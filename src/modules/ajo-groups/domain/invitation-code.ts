import { createHmac } from 'node:crypto';
import { normaliseShareCode, randomShareCode } from '../../../common/links/share-code.js';

/** Length of an invitation code issued from now on, e.g. ajocloud.com/g/7KQ3MZP2AC. */
export const INVITATION_CODE_LENGTH = 10;

/**
 * The stored form of an invitation code.
 *
 * HMAC rather than a bare hash: the pepper lives outside the database, so a
 * leaked table cannot be brute-forced back into working invitation links. A
 * plain SHA-256 of a code would be, since the code alphabet is known.
 *
 * Issuing and redeeming must agree on this exactly — a mismatch makes every new
 * invitation unredeemable — so both sides call this one function rather than
 * each hashing for themselves, on the canonical form of the code.
 */
export function digestInvitationCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

/**
 * A fresh invitation code: 10 characters from the share-code alphabet.
 *
 * About 48 bits. Short enough for a link someone would forward, and still far
 * beyond guessing: every lookup that takes one is rate limited, an invitation
 * expires, and it admits only as many people as it was issued for.
 */
export function generateInvitationCode(): string {
  return randomShareCode(INVITATION_CODE_LENGTH);
}

/** Codes issued before short links: 32 bytes of base64url, 43 characters. */
const LEGACY_INVITATION_CODE = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * The form an invitation code is digested in, or null when the input cannot
 * be one.
 *
 * A current code is case-insensitive, like every short code, so it is upper
 * cased. A legacy code is base64url and case matters, so it is kept exactly;
 * those stay redeemable until they expire.
 */
export function canonicalInvitationCode(input: unknown): string | null {
  const short = normaliseShareCode(input, INVITATION_CODE_LENGTH);
  if (short) return short;
  if (typeof input === 'string' && LEGACY_INVITATION_CODE.test(input)) return input;
  return null;
}
