import { compareAddresses, isComparable, normaliseState } from './address-match.js';

const record = {
  line: '12 Admiralty Way, Lekki Phase 1',
  city: 'Lekki',
  lga: 'Eti-Osa',
  state: 'Lagos',
};

describe('compareAddresses', () => {
  it('accepts the same address written differently', () => {
    expect(
      compareAddresses(
        { line: 'No. 12, admiralty wy, Lekki phase 1', city: 'Lekki', state: 'Lagos State' },
        record,
      ),
    ).toEqual({ matches: true });
  });

  it('accepts the town typed in the city field rather than the line', () => {
    expect(
      compareAddresses({ line: '12 Admiralty Way Phase 1', city: 'Lekki', state: 'lagos' }, record),
    ).toEqual({ matches: true });
  });

  it('refuses another state', () => {
    expect(
      compareAddresses({ line: '12 Admiralty Way, Lekki Phase 1', state: 'Ogun' }, record),
    ).toEqual({ matches: false, reason: 'STATE' });
  });

  it('refuses another house number on the same street', () => {
    expect(
      compareAddresses({ line: '14 Admiralty Way, Lekki Phase 1', state: 'Lagos' }, record),
    ).toEqual({ matches: false, reason: 'HOUSE_NUMBER' });
  });

  it('refuses a different street', () => {
    expect(
      compareAddresses(
        { line: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' },
        { line: '12 Admiralty Way', city: 'Lekki', state: 'Lagos' },
      ),
    ).toEqual({ matches: false, reason: 'STREET' });
  });

  it('skips the state check when the record has none', () => {
    expect(
      compareAddresses(
        { line: '12 Admiralty Way, Lekki Phase 1', state: 'Ogun' },
        { line: '12 Admiralty Way, Lekki Phase 1' },
      ),
    ).toEqual({ matches: true });
  });
});

describe('normaliseState', () => {
  it('treats Abuja and the FCT as one', () => {
    expect(normaliseState('Abuja')).toBe(normaliseState('FCT'));
    expect(normaliseState('Federal Capital Territory')).toBe('fct');
  });

  it('ignores the word state', () => {
    expect(normaliseState('Cross River State')).toBe('cross river');
  });
});

describe('isComparable', () => {
  it('needs a line with words in it', () => {
    expect(isComparable(null)).toBe(false);
    expect(isComparable({ line: ' , ' })).toBe(false);
    expect(isComparable({ line: '5 Broad Street' })).toBe(true);
  });
});
