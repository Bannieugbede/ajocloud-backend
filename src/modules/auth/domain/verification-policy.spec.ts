import {
  maskVerificationDestination,
  verificationCodeHash,
  verificationCodeMatches,
} from './verification-policy.js';

describe('account verification policy', () => {
  const pepper = 'test-pepper-that-is-long-enough-for-hmac';

  it('matches only the intended challenge and code', () => {
    const hash = verificationCodeHash('challenge-1', '123456', pepper);
    expect(verificationCodeMatches('challenge-1', '123456', hash, pepper)).toBe(true);
    expect(verificationCodeMatches('challenge-1', '123457', hash, pepper)).toBe(false);
    expect(verificationCodeMatches('challenge-2', '123456', hash, pepper)).toBe(false);
  });

  it('masks destinations without exposing the full address', () => {
    expect(maskVerificationDestination('PHONE', '+2348012345678')).toBe('+234••••678');
    expect(maskVerificationDestination('EMAIL', 'member@example.test')).toBe('me•••@example.test');
  });
});
