import { billReferenceProblem, normaliseBillReference } from './bill-reference.js';

describe('bill references', () => {
  it.each([
    ['0803 123 4567', '08031234567'],
    ['+2348031234567', '08031234567'],
    ['2348031234567', '08031234567'],
    ['0803-123-4567', '08031234567'],
  ])('reduces the phone number %s to its local form', (raw, expected) => {
    expect(normaliseBillReference('phone', raw)).toBe(expected);
  });

  it('upper-cases account references so case cannot split one account in two', () => {
    expect(normaliseBillReference('account', ' spn-77ab ')).toBe('SPN77AB');
  });

  it.each([
    ['phone', '08031234567', true],
    ['phone', '09161234567', true],
    ['phone', '0803123456', false],
    ['phone', '05031234567', false],
    ['meter', '45012345678', true],
    ['meter', '4501234', false],
    ['smartcard', '7020147841', true],
    ['smartcard', '70201', false],
    ['account', 'SPN77CHANNEL01', true],
    ['account', 'AB1', false],
  ] as const)('judges the %s reference %s valid: %s', (kind, reference, valid) => {
    expect(billReferenceProblem(kind, reference) === null).toBe(valid);
  });
});
