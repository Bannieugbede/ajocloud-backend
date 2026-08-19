/** Length of a transaction PIN. Fixed so the UI can render a known number of boxes. */
export const TRANSACTION_PIN_LENGTH = 4;

/** Consecutive wrong attempts before the PIN locks. */
export const TRANSACTION_PIN_MAX_ATTEMPTS = 5;

/** How long a locked PIN stays locked. */
export const TRANSACTION_PIN_LOCK_MS = 15 * 60 * 1_000;

/**
 * PINs that are trivially guessable. A four-digit space is small enough that
 * the obvious sequences are tried first, so they are refused outright rather
 * than left to rate limiting.
 */
export function isWeakTransactionPin(pin: string): boolean {
  if (!/^\d+$/.test(pin)) return false;
  // All one digit, e.g. 0000.
  if (new Set(pin).size === 1) return true;
  const digits = [...pin].map(Number);
  const ascending = digits.every(
    (digit, index) => index === 0 || digit === (digits[index - 1] as number) + 1,
  );
  const descending = digits.every(
    (digit, index) => index === 0 || digit === (digits[index - 1] as number) - 1,
  );
  return ascending || descending;
}

export function isValidTransactionPinShape(pin: string): boolean {
  return new RegExp(`^\\d{${TRANSACTION_PIN_LENGTH}}$`).test(pin);
}

export function isPinLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

/**
 * State after a wrong attempt. The counter keeps climbing past the limit so a
 * caller can tell a first lockout from repeated hammering, but any count at or
 * above the limit locks.
 */
export function registerFailedAttempt(
  failedCount: number,
  now: Date,
): { failedCount: number; lockedUntil: Date | null } {
  const next = failedCount + 1;
  return {
    failedCount: next,
    lockedUntil:
      next >= TRANSACTION_PIN_MAX_ATTEMPTS
        ? new Date(now.getTime() + TRANSACTION_PIN_LOCK_MS)
        : null,
  };
}
