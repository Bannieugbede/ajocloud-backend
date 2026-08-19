import { createHmac } from 'node:crypto';

/**
 * Rules for Tier 2 identity verification, per ADR-004. Everything here is pure
 * so the policy can be tested without a provider, a database, or a network.
 *
 * No function in this file accepts a raw identifier and returns it, and none
 * writes one anywhere. Callers hold the identifier for the life of one request
 * and discard it.
 */

/** BVN and NIN are both exactly 11 digits. vNIN is 16 alphanumeric characters. */
const BVN_PATTERN = /^\d{11}$/;
const NIN_PATTERN = /^\d{11}$/;
const VNIN_PATTERN = /^[A-Za-z0-9]{16}$/;

/** Nigerian bank account numbers (NUBAN) are 10 digits. */
const ACCOUNT_NUMBER_PATTERN = /^\d{10}$/;

export type IdentityKind = 'BVN' | 'NIN' | 'VNIN';

/** Failed checks allowed per user before verification is refused. */
export const IDENTITY_MAX_FAILED_ATTEMPTS = 5;

/** Window over which failed attempts accumulate. */
export const IDENTITY_ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1_000;

/** How long a provider-supplied bank list is served before it is refetched. */
export const BANK_LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

export function isValidIdentityNumber(kind: IdentityKind, value: string): boolean {
  const normalized = normalizeIdentityNumber(value);
  if (kind === 'BVN') return BVN_PATTERN.test(normalized);
  if (kind === 'NIN') return NIN_PATTERN.test(normalized);
  return VNIN_PATTERN.test(normalized);
}

export function isValidAccountNumber(value: string): boolean {
  return ACCOUNT_NUMBER_PATTERN.test(value.replace(/\s/g, ''));
}

/** Strips the spacing users type; never changes which identifier this is. */
export function normalizeIdentityNumber(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/**
 * A stable, non-reversible fingerprint of an account number, so the same
 * account is recognised across links without the number being stored. Uses the
 * deployment's token pepper as the HMAC key, so a database copy alone does not
 * permit offline enumeration of the 10-digit space.
 */
export function accountNumberDigest(accountNumber: string, pepper: string): string {
  return createHmac('sha256', pepper)
    .update(`bank-account:${accountNumber.replace(/\s/g, '')}`)
    .digest('hex');
}

/**
 * Whether the user has burned their attempt budget. Attempts older than the
 * window do not count, so a legitimate user is never locked out permanently.
 */
export function hasExhaustedAttempts(
  failedAttemptTimes: readonly Date[],
  now: Date,
  windowMs: number = IDENTITY_ATTEMPT_WINDOW_MS,
): boolean {
  const cutoff = now.getTime() - windowMs;
  const recent = failedAttemptTimes.filter((at) => at.getTime() >= cutoff);
  return recent.length >= IDENTITY_MAX_FAILED_ATTEMPTS;
}

/**
 * Compares a provider-returned legal name against the profile name.
 *
 * Advisory only (ADR-004): a mismatch raises a risk flag and sends the profile
 * to review, and never auto-rejects. Nigerian names vary legitimately in
 * ordering, spelling, and diacritics, so an automatic reject on fuzzy
 * comparison would exclude real users.
 */
export function namesMatch(providerName: string, profileName: string): boolean {
  const a = nameTokens(providerName);
  const b = nameTokens(profileName);
  if (a.length === 0 || b.length === 0) return false;
  // Order-insensitive: providers return "SURNAME FIRSTNAME" inconsistently.
  const shared = a.filter((token) => b.includes(token));
  return shared.length >= Math.min(2, Math.min(a.length, b.length));
}

function nameTokens(value: string): string[] {
  return (
    value
      .normalize('NFD')
      // Drop combining marks so "Adéyẹmi" and "Adeyemi" compare equal.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((token) => token.length > 1)
  );
}

/**
 * Whether a profile has everything Tier 2 requires: complete personal details,
 * a passed identity check, and a verified bank account.
 */
export function qualifiesForTier2(input: {
  readonly personalDetailsComplete: boolean;
  readonly identityCheckPassed: boolean;
  readonly bankAccountVerified: boolean;
}): boolean {
  return input.personalDetailsComplete && input.identityCheckPassed && input.bankAccountVerified;
}

/** Personal details required before Tier 2 can be granted. */
export function personalDetailsComplete(profile: {
  readonly dateOfBirth: Date | null;
  readonly gender: string | null;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly occupation: string | null;
}): boolean {
  return (
    profile.dateOfBirth !== null &&
    profile.gender !== null &&
    isPresent(profile.addressLine) &&
    isPresent(profile.city) &&
    isPresent(profile.state) &&
    isPresent(profile.occupation)
  );
}

function isPresent(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Minimum age to hold an account. */
export const MINIMUM_AGE_YEARS = 18;

export function isOldEnough(dateOfBirth: Date, now: Date): boolean {
  const eligibleFrom = new Date(dateOfBirth);
  eligibleFrom.setFullYear(eligibleFrom.getFullYear() + MINIMUM_AGE_YEARS);
  return eligibleFrom.getTime() <= now.getTime();
}
