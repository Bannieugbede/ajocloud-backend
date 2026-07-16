import { createHmac, timingSafeEqual } from 'node:crypto';

export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1_000;
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1_000;
export const VERIFICATION_MAX_ATTEMPTS = 5;

export function verificationCodeHash(challengeId: string, code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`${challengeId}:${code}`).digest('hex');
}

export function verificationCodeMatches(
  challengeId: string,
  code: string,
  expectedHash: string,
  pepper: string,
): boolean {
  const actual = Buffer.from(verificationCodeHash(challengeId, code, pepper));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function maskVerificationDestination(channel: 'PHONE' | 'EMAIL', value: string): string {
  if (channel === 'PHONE') return `${value.slice(0, 4)}••••${value.slice(-3)}`;
  const [local = '', domain = ''] = value.split('@');
  return `${local.slice(0, 2)}•••@${domain}`;
}
