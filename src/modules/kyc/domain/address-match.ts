/**
 * Compares the address a person types with the one on their NIN record
 * (ADR-015). Pure, so the tolerance can be tested and tuned in one place.
 *
 * The comparison has to forgive how Nigerians actually write addresses: "No. 5"
 * against "5", "St" against "Street", commas, casing, and the state given as
 * "Lagos" or "Lagos State". It must not forgive a different house number or a
 * different state, which is exactly what a borrowed identity would show.
 */

export interface PostalAddress {
  readonly line: string;
  readonly city?: string | null;
  readonly lga?: string | null;
  readonly state?: string | null;
}

const ABBREVIATIONS: Record<string, string> = {
  st: 'street',
  str: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  cl: 'close',
  cres: 'crescent',
  cresc: 'crescent',
  est: 'estate',
  ext: 'extension',
  off: 'off',
  opp: 'opposite',
  hse: 'house',
  blk: 'block',
  apt: 'apartment',
  dr: 'drive',
  ln: 'lane',
  wy: 'way',
};

/** Words that carry no location on their own. */
const NOISE = new Set(['no', 'number', 'the', 'of', 'and', 'by', 'at', 'along', 'beside', 'near']);

function tokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => ABBREVIATIONS[token] ?? token)
    .filter((token) => token.length > 0 && !NOISE.has(token));
}

function numbers(value: string): string[] {
  return tokens(value).filter((token) => /\d/.test(token));
}

/** "Lagos State", "lagos", "FCT" and "Abuja" compare as they should. */
export function normaliseState(value: string | null | undefined): string {
  const words = tokens(value).filter((token) => token !== 'state');
  const joined = words.join(' ');
  if (joined === 'fct' || joined === 'federal capital territory' || joined === 'abuja') {
    return 'fct';
  }
  return joined;
}

/** Share of the registered words the typed address also contains. */
export const MINIMUM_LINE_OVERLAP = 0.6;

export type AddressComparison =
  | { readonly matches: true }
  | { readonly matches: false; readonly reason: 'STATE' | 'HOUSE_NUMBER' | 'STREET' };

export function compareAddresses(
  submitted: PostalAddress,
  registered: PostalAddress,
): AddressComparison {
  const registeredState = normaliseState(registered.state);
  if (registeredState && normaliseState(submitted.state) !== registeredState) {
    return { matches: false, reason: 'STATE' };
  }

  // Every number on the record (house, block, plot) must appear as typed.
  const typedNumbers = new Set(numbers(submitted.line));
  if (numbers(registered.line).some((number) => !typedNumbers.has(number))) {
    return { matches: false, reason: 'HOUSE_NUMBER' };
  }

  // The street words are compared against everything typed, city and LGA
  // included, because the record often folds the town into the line.
  const typed = new Set([
    ...tokens(submitted.line),
    ...tokens(submitted.city),
    ...tokens(submitted.lga),
  ]);
  const expected = [...new Set(tokens(registered.line))].filter((token) => !/\d/.test(token));
  if (expected.length > 0) {
    const shared = expected.filter((token) => typed.has(token)).length;
    if (shared / expected.length < MINIMUM_LINE_OVERLAP) {
      return { matches: false, reason: 'STREET' };
    }
  }
  return { matches: true };
}

/** Whether a provider record holds enough of an address to compare against. */
export function isComparable(address: PostalAddress | null | undefined): address is PostalAddress {
  return Boolean(address && tokens(address.line).length > 0);
}
