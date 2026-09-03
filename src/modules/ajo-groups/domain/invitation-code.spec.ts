import { digestInvitationCode, generateInvitationCode } from './invitation-code.js';

describe('invitation codes', () => {
  it('generates a distinct code each time', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInvitationCode()));
    expect(codes.size).toBe(50);
  });

  it('generates URL-safe codes, since they travel in a path segment', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateInvitationCode()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('generates at least 32 characters, which is what join requires', () => {
    expect(generateInvitationCode().length).toBeGreaterThanOrEqual(32);
  });

  it('is deterministic, so a stored digest still matches later', () => {
    const code = generateInvitationCode();
    expect(digestInvitationCode(code, 'pepper')).toBe(digestInvitationCode(code, 'pepper'));
  });

  it('does not contain the code it digests', () => {
    const code = generateInvitationCode();
    expect(digestInvitationCode(code, 'pepper')).not.toContain(code);
  });

  it('depends on the pepper, not the code alone', () => {
    // The point of the pepper: a leaked table cannot be brute-forced back into
    // working links without it. If the digest ignored it, it would just be a
    // hash of a known-alphabet value.
    const code = generateInvitationCode();
    expect(digestInvitationCode(code, 'pepper-a')).not.toBe(digestInvitationCode(code, 'pepper-b'));
  });
});
