import { maskIdentityValue, safeVerificationResponse } from './identity-redaction.js';

describe('identity response redaction', () => {
  it('reveals only the final four characters', () => {
    expect(maskIdentityValue('12345678901')).toBe('*******8901');
  });

  it('has no field for raw identity data', () => {
    expect(
      safeVerificationResponse({
        providerReference: 'provider-ref',
        maskedIdentifier: '*******8901',
        status: 'PASSED',
      }),
    ).toEqual({
      providerReference: 'provider-ref',
      maskedIdentifier: '*******8901',
      status: 'PASSED',
    });
  });
});
