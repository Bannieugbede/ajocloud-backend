import {
  PUBLIC_CODE_LENGTH,
  SHARE_CODE_ALPHABET,
  normalisePublicCode,
  normaliseShareCode,
  randomShareCode,
} from './share-code.js';

describe('share codes', () => {
  it('draws codes of the requested length from the alphabet', () => {
    for (const length of [7, 10]) {
      expect(randomShareCode(length)).toMatch(new RegExp(`^[${SHARE_CODE_ALPHABET}]{${length}}$`));
    }
  });

  it('uses the whole alphabet rather than favouring its start', () => {
    const drawn = new Set(Array.from({ length: 300 }, () => randomShareCode(10)).join(''));
    expect(drawn.size).toBe(SHARE_CODE_ALPHABET.length);
  });

  it('never emits a character that is misread from a screenshot', () => {
    expect(Array.from({ length: 200 }, () => randomShareCode(10)).join('')).not.toMatch(
      /[01OILB8]/,
    );
  });

  it('reads a code the way people retype it', () => {
    expect(normalisePublicCode(' 7kq-3mz p ')).toBe('7KQ3MZP');
  });

  it.each([
    ['too short', '7KQ3MZ'],
    ['too long', '7KQ3MZPA'],
    ['an ambiguous character', '7KQ3MZ0'],
    ['a path', '../../x'],
    ['not a string', 42],
  ])('refuses %s', (_label, input) => {
    expect(normalisePublicCode(input)).toBeNull();
  });

  it('tells the kinds apart by length', () => {
    const invitation = randomShareCode(10);
    expect(normalisePublicCode(invitation)).toBeNull();
    expect(normaliseShareCode(invitation, 10)).toBe(invitation);
    expect(PUBLIC_CODE_LENGTH).toBe(7);
  });
});
