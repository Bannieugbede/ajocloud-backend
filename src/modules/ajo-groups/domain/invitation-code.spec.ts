import {
  INVITATION_CODE_LENGTH,
  canonicalInvitationCode,
  digestInvitationCode,
  generateInvitationCode,
} from './invitation-code.js';

describe('invitation codes', () => {
  it('generates a distinct code each time', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInvitationCode()));
    expect(codes.size).toBe(50);
  });

  it('generates short, URL-safe codes, since they travel in a link', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateInvitationCode()).toMatch(/^[2345679ACDEFGHJKMNPQRTUVWXYZ]{10}$/);
    }
    expect(INVITATION_CODE_LENGTH).toBe(10);
  });

  it('reads a current code case-insensitively, as people retype it', () => {
    const code = generateInvitationCode();
    expect(canonicalInvitationCode(code.toLowerCase())).toBe(code);
    expect(canonicalInvitationCode(` ${code.slice(0, 5)}-${code.slice(5)} `)).toBe(code);
  });

  it('keeps a legacy code exactly, because base64url is case-sensitive', () => {
    const legacy = 'q7Xv3nRk2LpZ8sWt4YbG1mHc6dJfN0uA9eKiOxPzQrE';
    expect(canonicalInvitationCode(legacy)).toBe(legacy);
  });

  it.each([
    ['a public group code', '7KQ3MZP'],
    ['a short junk string', 'abc123'],
    ['a path', '../../admin'],
    ['something enormous', 'a'.repeat(500)],
    ['not a string', 7],
  ])('refuses %s', (_label, input) => {
    expect(canonicalInvitationCode(input)).toBeNull();
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
