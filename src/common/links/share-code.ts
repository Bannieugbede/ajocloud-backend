import { randomBytes } from 'node:crypto';

/**
 * The codes in shared links: ajocloud.com/g/<code>, /p/<code> and /f/<code>.
 *
 * One alphabet for all of them, the referral code's: 0/O, 1/I/L and 8/B are
 * left out because those are the pairs people mistype from a screenshot or
 * hear wrong when a code is read aloud. Codes compare case-insensitively.
 *
 * Two lengths, and the length says which kind a code is:
 * - 7 characters: a group's permanent public code. Not a secret. The database
 *   generates it (`share_code(7)` in the short_links migration).
 * - 10 characters: an Ajo invitation. A secret, drawn here from
 *   crypto.randomBytes and stored only as an HMAC.
 * Akawo join codes keep their own 8-character alphabet (pool-policy.ts), so
 * no two kinds can be confused.
 */
export const SHARE_CODE_ALPHABET = '2345679ACDEFGHJKMNPQRTUVWXYZ';

export const PUBLIC_CODE_LENGTH = 7;

/**
 * A random code of the given length, every character equally likely.
 *
 * A modulo without rejection would favour the start of the alphabet when 256
 * is not a multiple of its length, so out-of-range bytes are discarded.
 */
export function randomShareCode(length: number): string {
  const limit = Math.floor(256 / SHARE_CODE_ALPHABET.length) * SHARE_CODE_ALPHABET.length;
  let code = '';
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      code += SHARE_CODE_ALPHABET[byte % SHARE_CODE_ALPHABET.length];
      if (code.length === length) break;
    }
  }
  return code;
}

/**
 * The canonical form of a code of the given length, or null when the input
 * cannot be one. Accepts lower case, spaces and dashes, which is how people
 * retype a code.
 */
export function normaliseShareCode(input: unknown, length: number): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== length) return null;
  for (const character of code) {
    if (!SHARE_CODE_ALPHABET.includes(character)) return null;
  }
  return code;
}

/** A group's public code in canonical form, or null. */
export function normalisePublicCode(input: unknown): string | null {
  return normaliseShareCode(input, PUBLIC_CODE_LENGTH);
}
