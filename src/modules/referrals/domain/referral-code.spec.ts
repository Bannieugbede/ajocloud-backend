import { generateReferralCode, normaliseReferralCode } from './referral-code.js';

describe('generateReferralCode', () => {
  it('produces a prefixed code of the expected shape', () => {
    expect(generateReferralCode()).toMatch(/^AJO-[2345679ACDEFGHJKMNPQRTUVWXYZ]{6}$/);
  });

  it('never emits a character that is misread from a screenshot', () => {
    // 0/O, 1/I/L and 8/B are the pairs people actually mistype. Only the body
    // is checked: the "AJO-" prefix is fixed and carries its own O, which is
    // unambiguous because it is always the brand rather than a digit.
    const bodies = Array.from({ length: 200 }, () => generateReferralCode().slice(4)).join('');
    expect(bodies).not.toMatch(/[01OILB]/);
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateReferralCode()));
    expect(codes.size).toBe(500);
  });

  it('uses the whole alphabet rather than favouring its start', () => {
    // A modulo without rejection would bias toward the first few letters. With
    // 28 letters over 3,000 draws, every one should appear.
    const drawn = new Set(
      Array.from({ length: 500 }, () => generateReferralCode().slice(4)).join(''),
    );
    expect(drawn.size).toBe(28);
  });

  it('round-trips through normalisation', () => {
    const code = generateReferralCode();
    expect(normaliseReferralCode(code)).toBe(code);
  });
});

describe('normaliseReferralCode', () => {
  it('accepts the canonical form', () => {
    expect(normaliseReferralCode('AJO-ACDEFG')).toBe('AJO-ACDEFG');
  });

  it('accepts what a person actually types', () => {
    // Lower case, no prefix, and stray spacing are all correct in every way
    // that matters; rejecting them would fail a valid code.
    expect(normaliseReferralCode('ajo-acdefg')).toBe('AJO-ACDEFG');
    expect(normaliseReferralCode('ACDEFG')).toBe('AJO-ACDEFG');
    expect(normaliseReferralCode('  acdefg  ')).toBe('AJO-ACDEFG');
    expect(normaliseReferralCode('AJO- ACD EFG')).toBe('AJO-ACDEFG');
  });

  it('refuses a code of the wrong length', () => {
    expect(normaliseReferralCode('AJO-ACDEF')).toBeNull();
    expect(normaliseReferralCode('AJO-ACDEFGH')).toBeNull();
    expect(normaliseReferralCode('')).toBeNull();
  });

  it('refuses characters outside the alphabet', () => {
    // Including the excluded look-alikes: someone who typed O for 0 has a
    // different code, and guessing which they meant would credit the wrong
    // person.
    expect(normaliseReferralCode('AJO-ACDEF0')).toBeNull();
    expect(normaliseReferralCode('AJO-ACDEF8')).toBeNull();
    expect(normaliseReferralCode('AJO-ACDEFO')).toBeNull();
    expect(normaliseReferralCode('AJO-ACDEF!')).toBeNull();
  });

  it('refuses a non-string without throwing', () => {
    expect(normaliseReferralCode(null as unknown as string)).toBeNull();
    expect(normaliseReferralCode(undefined as unknown as string)).toBeNull();
  });
});
