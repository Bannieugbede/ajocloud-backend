import {
  TRANSACTION_PIN_LOCK_MS,
  TRANSACTION_PIN_MAX_ATTEMPTS,
  isPinLocked,
  isValidTransactionPinShape,
  isWeakTransactionPin,
  registerFailedAttempt,
} from './transaction-pin-policy.js';

describe('transaction PIN policy', () => {
  describe('shape', () => {
    it('accepts exactly four digits', () => {
      expect(isValidTransactionPinShape('1357')).toBe(true);
    });

    it('rejects wrong lengths and non-digits', () => {
      for (const value of ['135', '13579', '', '13a7', '1 37']) {
        expect(isValidTransactionPinShape(value)).toBe(false);
      }
    });
  });

  describe('weak PINs', () => {
    it('rejects a repeated digit', () => {
      for (const value of ['0000', '1111', '9999']) {
        expect(isWeakTransactionPin(value)).toBe(true);
      }
    });

    it('rejects straight runs in either direction', () => {
      expect(isWeakTransactionPin('1234')).toBe(true);
      expect(isWeakTransactionPin('4321')).toBe(true);
      expect(isWeakTransactionPin('6789')).toBe(true);
    });

    it('accepts a PIN with no obvious pattern', () => {
      for (const value of ['1357', '2846', '9042']) {
        expect(isWeakTransactionPin(value)).toBe(false);
      }
    });

    it('does not treat a wrapping sequence as a run', () => {
      // 8,9,0,1 is not arithmetically ascending, so it is allowed.
      expect(isWeakTransactionPin('8901')).toBe(false);
    });
  });

  describe('lockout', () => {
    const now = new Date('2026-08-19T10:00:00.000Z');

    it('is unlocked when no lock is set', () => {
      expect(isPinLocked(null, now)).toBe(false);
    });

    it('is unlocked once the lock has expired', () => {
      expect(isPinLocked(new Date(now.getTime() - 1), now)).toBe(false);
    });

    it('is locked while the lock is in the future', () => {
      expect(isPinLocked(new Date(now.getTime() + 1_000), now)).toBe(true);
    });

    it('counts failures without locking below the limit', () => {
      const result = registerFailedAttempt(0, now);
      expect(result).toEqual({ failedCount: 1, lockedUntil: null });
    });

    it('locks on reaching the attempt limit', () => {
      const result = registerFailedAttempt(TRANSACTION_PIN_MAX_ATTEMPTS - 1, now);
      expect(result.failedCount).toBe(TRANSACTION_PIN_MAX_ATTEMPTS);
      expect(result.lockedUntil).toEqual(new Date(now.getTime() + TRANSACTION_PIN_LOCK_MS));
    });

    it('keeps locking past the limit', () => {
      const result = registerFailedAttempt(TRANSACTION_PIN_MAX_ATTEMPTS + 2, now);
      expect(result.lockedUntil).not.toBeNull();
    });
  });
});
