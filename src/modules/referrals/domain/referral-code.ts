import { randomBytes } from 'node:crypto';

/**
 * The code a member shares to refer someone.
 *
 * Shaped to survive being read aloud, typed from a screenshot, and pasted into
 * WhatsApp: an unambiguous alphabet, a fixed length, and a prefix that says
 * what it is. It is not a secret — it identifies who gets the credit, and
 * knowing someone else's earns nothing — so it is generated for legibility
 * rather than for entropy against guessing.
 */

/**
 * Deliberately excludes 0/O, 1/I/L and 8/B. Those pairs are the ones people
 * actually mistype from a screenshot, and a referral that silently credits
 * nobody is worse than one that is a character longer.
 */
const ALPHABET = '2345679ACDEFGHJKMNPQRTUVWXYZ';

const PREFIX = 'AJO-';
const BODY_LENGTH = 6;

/**
 * A new code. Random rather than derived from the user's name: a name-based
 * code leaks who the member is to everyone they share it with, and collides
 * for the many people who share a name.
 */
export function generateReferralCode(): string {
  // Rejection-free selection would bias toward the first few letters when 256
  // is not a multiple of the alphabet size. Drawing extra bytes and discarding
  // the out-of-range ones keeps every character equally likely.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let body = '';
  while (body.length < BODY_LENGTH) {
    for (const byte of randomBytes(BODY_LENGTH * 2)) {
      if (byte >= limit) continue;
      body += ALPHABET[byte % ALPHABET.length];
      if (body.length === BODY_LENGTH) break;
    }
  }
  return `${PREFIX}${body}`;
}

/**
 * The canonical form of a code someone typed, or null when it cannot be one.
 *
 * Accepts what a person plausibly enters — lower case, missing prefix,
 * surrounding spaces — because rejecting those would fail a code that is
 * correct in every way that matters. Anything else returns null rather than
 * being coerced into a lookup that would quietly find nothing.
 */
export function normaliseReferralCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toUpperCase().replace(/\s+/g, '');
  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
  if (body.length !== BODY_LENGTH) return null;
  for (const character of body) {
    if (!ALPHABET.includes(character)) return null;
  }
  return `${PREFIX}${body}`;
}
