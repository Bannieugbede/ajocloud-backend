import { referralQualifies } from './referral-qualification.js';

const rule = {
  qualifyingProduct: 'AJO',
  qualifyingEvent: 'CONTRIBUTION_SETTLED',
  minimumTransactionCount: 2,
  requiredKycTier: 2 as const,
};

describe('referral qualification', () => {
  it('does not reward registration alone', () => {
    expect(
      referralQualifies({
        selfReferral: false,
        duplicateIdentity: false,
        referredUserKycTier: 2,
        rule,
        activities: [],
      }),
    ).toBe(false);
  });

  it('uses the configured settled transaction count', () => {
    expect(
      referralQualifies({
        selfReferral: false,
        duplicateIdentity: false,
        referredUserKycTier: 2,
        rule,
        activities: [
          { product: 'AJO', event: 'CONTRIBUTION_SETTLED', amountMinor: 1n, status: 'SETTLED' },
          { product: 'AJO', event: 'CONTRIBUTION_SETTLED', amountMinor: 1n, status: 'SETTLED' },
        ],
      }),
    ).toBe(true);
  });

  it.each(['FAILED', 'REVERSED'] as const)('does not count %s activities', (status) => {
    expect(
      referralQualifies({
        selfReferral: false,
        duplicateIdentity: false,
        referredUserKycTier: 3,
        rule: { ...rule, minimumTransactionCount: 1 },
        activities: [{ product: 'AJO', event: 'CONTRIBUTION_SETTLED', amountMinor: 1n, status }],
      }),
    ).toBe(false);
  });

  it('rejects self-referrals and duplicate identity abuse', () => {
    const activity = {
      product: 'AJO',
      event: 'CONTRIBUTION_SETTLED',
      amountMinor: 1n,
      status: 'SETTLED' as const,
    };
    expect(
      referralQualifies({
        selfReferral: true,
        duplicateIdentity: false,
        referredUserKycTier: 3,
        rule: { ...rule, minimumTransactionCount: 1 },
        activities: [activity],
      }),
    ).toBe(false);
    expect(
      referralQualifies({
        selfReferral: false,
        duplicateIdentity: true,
        referredUserKycTier: 3,
        rule: { ...rule, minimumTransactionCount: 1 },
        activities: [activity],
      }),
    ).toBe(false);
  });
});
