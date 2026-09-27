/**
 * What a biller identifies its customer by.
 *
 * The kind decides both how a reference is written down (a phone number is
 * canonicalised to its local 11-digit form) and what shape it must have before
 * a provider is asked about it at all.
 */
export type BillReferenceKind = 'phone' | 'meter' | 'smartcard' | 'account';

export const BILL_REFERENCE_KINDS: readonly BillReferenceKind[] = [
  'phone',
  'meter',
  'smartcard',
  'account',
];

/** The field label shown to a payer when a biller does not name its own. */
export function defaultReferenceLabel(kind: BillReferenceKind): string {
  switch (kind) {
    case 'phone':
      return 'Phone number';
    case 'meter':
      return 'Meter number';
    case 'smartcard':
      return 'Smartcard number';
    case 'account':
      return 'Account number';
  }
}

/**
 * The reference in the one form it is stored, validated, and paid with.
 *
 * Phone numbers arrive as "0803 123 4567", "+2348031234567" or
 * "2348031234567"; all three are the same line and are reduced to
 * "08031234567" so a validation and the payment that quotes it cannot disagree
 * over formatting. Other kinds only lose surrounding space and separators.
 */
export function normaliseBillReference(kind: BillReferenceKind, raw: string): string {
  const compact = raw.trim().replace(/[\s-]/g, '');
  if (kind !== 'phone') return compact.toUpperCase();
  const digits = compact.replace(/^\+/, '');
  if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;
  return digits;
}

/**
 * Why a normalised reference cannot belong to this kind, or null when its
 * shape is plausible. Shape only: whether the meter or line exists is the
 * provider's answer, not ours.
 */
export function billReferenceProblem(kind: BillReferenceKind, reference: string): string | null {
  switch (kind) {
    case 'phone':
      return /^0[789][01]\d{8}$/.test(reference)
        ? null
        : 'Enter an 11-digit Nigerian phone number, for example 08031234567.';
    case 'meter':
      return /^\d{11,13}$/.test(reference) ? null : 'A meter number is 11 to 13 digits.';
    case 'smartcard':
      return /^\d{10,12}$/.test(reference) ? null : 'A smartcard or IUC number is 10 to 12 digits.';
    case 'account':
      return /^[A-Z0-9]{6,20}$/.test(reference)
        ? null
        : 'An account number is 6 to 20 letters or digits.';
  }
}
