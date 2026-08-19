import {
  IDENTITY_MAX_FAILED_ATTEMPTS,
  accountNumberDigest,
  hasExhaustedAttempts,
  isOldEnough,
  isValidAccountNumber,
  isValidIdentityNumber,
  namesMatch,
  normalizeIdentityNumber,
  personalDetailsComplete,
  qualifiesForTier2,
} from './identity-verification-policy.js';

describe('identity number shape', () => {
  it('accepts an 11-digit BVN and NIN', () => {
    expect(isValidIdentityNumber('BVN', '12345678901')).toBe(true);
    expect(isValidIdentityNumber('NIN', '12345678901')).toBe(true);
  });

  it('accepts a 16-character vNIN', () => {
    expect(isValidIdentityNumber('VNIN', 'AB12CD34EF56GH78')).toBe(true);
  });

  it('rejects the wrong length so no malformed value reaches the provider', () => {
    expect(isValidIdentityNumber('BVN', '1234567890')).toBe(false);
    expect(isValidIdentityNumber('BVN', '123456789012')).toBe(false);
    expect(isValidIdentityNumber('VNIN', 'AB12CD34')).toBe(false);
  });

  it('rejects non-digits in a BVN', () => {
    expect(isValidIdentityNumber('BVN', '1234567890X')).toBe(false);
  });

  it('tolerates the spacing users type', () => {
    expect(normalizeIdentityNumber('123 456 789 01')).toBe('12345678901');
    expect(isValidIdentityNumber('BVN', '123 456 789 01')).toBe(true);
  });
});

describe('account number shape', () => {
  it('accepts a 10-digit NUBAN', () => {
    expect(isValidAccountNumber('0123456789')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidAccountNumber('012345678')).toBe(false);
    expect(isValidAccountNumber('01234567890')).toBe(false);
    expect(isValidAccountNumber('012345678X')).toBe(false);
  });
});

describe('account number digest', () => {
  it('is stable for the same account and pepper', () => {
    expect(accountNumberDigest('0123456789', 'pepper')).toBe(
      accountNumberDigest('0123456789', 'pepper'),
    );
  });

  it('differs per account and per deployment pepper', () => {
    expect(accountNumberDigest('0123456789', 'pepper')).not.toBe(
      accountNumberDigest('9876543210', 'pepper'),
    );
    expect(accountNumberDigest('0123456789', 'pepper-a')).not.toBe(
      accountNumberDigest('0123456789', 'pepper-b'),
    );
  });

  it('never contains the account number it was derived from', () => {
    expect(accountNumberDigest('0123456789', 'pepper')).not.toContain('0123456789');
  });
});

describe('attempt limiting', () => {
  const now = new Date('2026-08-19T12:00:00Z');

  it('allows a user below the limit', () => {
    const attempts = Array.from(
      { length: IDENTITY_MAX_FAILED_ATTEMPTS - 1 },
      () => new Date('2026-08-19T11:00:00Z'),
    );
    expect(hasExhaustedAttempts(attempts, now)).toBe(false);
  });

  it('refuses once the limit is reached', () => {
    const attempts = Array.from(
      { length: IDENTITY_MAX_FAILED_ATTEMPTS },
      () => new Date('2026-08-19T11:00:00Z'),
    );
    expect(hasExhaustedAttempts(attempts, now)).toBe(true);
  });

  it('ignores attempts older than the window, so nobody is locked out forever', () => {
    const attempts = Array.from(
      { length: IDENTITY_MAX_FAILED_ATTEMPTS },
      () => new Date('2026-08-17T11:00:00Z'),
    );
    expect(hasExhaustedAttempts(attempts, now)).toBe(false);
  });
});

describe('name matching', () => {
  it('matches when both names share their tokens', () => {
    expect(namesMatch('ADA CHIOMA OKAFOR', 'Ada Okafor')).toBe(true);
  });

  it('matches regardless of token order, since providers vary', () => {
    expect(namesMatch('OKAFOR ADA', 'Ada Okafor')).toBe(true);
  });

  it('ignores diacritics rather than treating them as a mismatch', () => {
    expect(namesMatch('ADÉYẸMI BÍSÍ', 'Adeyemi Bisi')).toBe(true);
  });

  it('reports an unrelated name as not matching', () => {
    expect(namesMatch('Ada Okafor', 'Tunde Balogun')).toBe(false);
  });

  it('treats an empty name as not matching rather than as a pass', () => {
    expect(namesMatch('', 'Ada Okafor')).toBe(false);
  });
});

describe('personal details completeness', () => {
  const complete = {
    dateOfBirth: new Date('1995-01-01'),
    gender: 'FEMALE',
    addressLine: '12 Marina Road',
    city: 'Lagos',
    state: 'Lagos',
    occupation: 'Trader',
  };

  it('accepts a fully populated profile', () => {
    expect(personalDetailsComplete(complete)).toBe(true);
  });

  it('rejects a missing field', () => {
    expect(personalDetailsComplete({ ...complete, occupation: null })).toBe(false);
    expect(personalDetailsComplete({ ...complete, dateOfBirth: null })).toBe(false);
  });

  it('rejects whitespace as a value', () => {
    expect(personalDetailsComplete({ ...complete, city: '   ' })).toBe(false);
  });
});

describe('tier 2 qualification', () => {
  it('requires all three of details, identity, and bank account', () => {
    expect(
      qualifiesForTier2({
        personalDetailsComplete: true,
        identityCheckPassed: true,
        bankAccountVerified: true,
      }),
    ).toBe(true);
  });

  it('withholds the tier when any part is missing', () => {
    expect(
      qualifiesForTier2({
        personalDetailsComplete: true,
        identityCheckPassed: true,
        bankAccountVerified: false,
      }),
    ).toBe(false);
    expect(
      qualifiesForTier2({
        personalDetailsComplete: false,
        identityCheckPassed: true,
        bankAccountVerified: true,
      }),
    ).toBe(false);
  });
});

describe('minimum age', () => {
  const now = new Date('2026-08-19T00:00:00Z');

  it('accepts someone over eighteen', () => {
    expect(isOldEnough(new Date('2000-01-01'), now)).toBe(true);
  });

  it('rejects someone under eighteen', () => {
    expect(isOldEnough(new Date('2015-01-01'), now)).toBe(false);
  });

  it('accepts someone on their eighteenth birthday', () => {
    expect(isOldEnough(new Date('2008-08-19T00:00:00Z'), now)).toBe(true);
  });
});
