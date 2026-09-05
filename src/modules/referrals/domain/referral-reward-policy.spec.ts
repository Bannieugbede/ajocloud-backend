import {
  awardRefusalReason,
  campaignIneligibleReason,
  rewardIdempotencyKey,
  rewardReversalIdempotencyKey,
  totalReleasedMinor,
  type AwardContext,
  type CampaignTerms,
} from './referral-reward-policy.js';

const EFFECTIVE = new Date('2026-01-01T00:00:00Z');
const DURING = new Date('2026-06-01T00:00:00Z');

const terms: CampaignTerms = {
  id: 'campaign-1',
  version: 1,
  status: 'ACTIVE',
  rewardAmountMinor: 100_000n,
  rewardCurrency: 'NGN',
  maximumRewards: 20,
  requiredKycTier: 1,
  minimumAmountMinor: null,
  effectiveAt: EFFECTIVE,
  expiresAt: null,
};

const context: AwardContext = {
  selfReferral: false,
  duplicateIdentity: false,
  referredUserKycTier: 1,
  depositAmountMinor: 500_000n,
  depositCurrency: 'NGN',
  referrerRewardCount: 0,
  occurredAt: DURING,
};

describe('campaignIneligibleReason', () => {
  it('accepts an active campaign during its window', () => {
    expect(campaignIneligibleReason(terms, DURING)).toBeNull();
  });

  it.each(['DRAFT', 'PAUSED', 'ENDED'] as const)('refuses a %s campaign', (status) => {
    expect(campaignIneligibleReason({ ...terms, status }, DURING)).toBe('campaign is not active');
  });

  it('refuses an event before the campaign started', () => {
    expect(campaignIneligibleReason(terms, new Date('2025-12-31T23:59:59Z'))).toBe(
      'campaign had not started',
    );
  });

  it('judges by when the event happened, not by now', () => {
    const expiring = { ...terms, expiresAt: new Date('2026-03-01T00:00:00Z') };
    // Settled while the campaign ran: still eligible, even though it has since
    // ended. The reverse — settling after the end — is not.
    expect(campaignIneligibleReason(expiring, new Date('2026-02-01T00:00:00Z'))).toBeNull();
    expect(campaignIneligibleReason(expiring, DURING)).toBe('campaign had ended');
  });

  it('refuses a campaign with no reward amount', () => {
    expect(campaignIneligibleReason({ ...terms, rewardAmountMinor: 0n }, DURING)).toBe(
      'campaign has no reward amount',
    );
  });
});

describe('awardRefusalReason', () => {
  it('permits a clean referral', () => {
    expect(awardRefusalReason(terms, context)).toBeNull();
  });

  it('refuses a self-referral', () => {
    expect(awardRefusalReason(terms, { ...context, selfReferral: true })).toBe('self-referral');
  });

  it('refuses a duplicate identity', () => {
    expect(awardRefusalReason(terms, { ...context, duplicateIdentity: true })).toBe(
      'duplicate identity',
    );
  });

  it('refuses a referred user below the required KYC tier', () => {
    expect(
      awardRefusalReason({ ...terms, requiredKycTier: 2 }, { ...context, referredUserKycTier: 1 }),
    ).toBe('referred user has not verified identity to the required tier');
  });

  it('accepts a referred user above the required tier', () => {
    expect(
      awardRefusalReason({ ...terms, requiredKycTier: 2 }, { ...context, referredUserKycTier: 3 }),
    ).toBeNull();
  });

  it('refuses to pay a reward in a currency the deposit was not made in', () => {
    expect(awardRefusalReason(terms, { ...context, depositCurrency: 'USD' })).toBe(
      'deposit currency does not match the campaign',
    );
  });

  it('refuses a deposit below the campaign minimum', () => {
    const withMinimum = { ...terms, minimumAmountMinor: 500_000n };
    expect(awardRefusalReason(withMinimum, { ...context, depositAmountMinor: 499_999n })).toBe(
      'deposit is below the campaign minimum',
    );
    // Exactly the minimum qualifies: the bound is inclusive.
    expect(
      awardRefusalReason(withMinimum, { ...context, depositAmountMinor: 500_000n }),
    ).toBeNull();
  });

  describe('the cap', () => {
    it('permits the last reward under the cap', () => {
      expect(awardRefusalReason(terms, { ...context, referrerRewardCount: 19 })).toBeNull();
    });

    it('refuses once the cap is reached', () => {
      expect(awardRefusalReason(terms, { ...context, referrerRewardCount: 20 })).toBe(
        'referrer has reached the campaign reward cap',
      );
    });

    it('refuses beyond the cap, rather than only exactly at it', () => {
      expect(awardRefusalReason(terms, { ...context, referrerRewardCount: 21 })).toBe(
        'referrer has reached the campaign reward cap',
      );
    });

    it('treats a null cap as uncapped', () => {
      expect(
        awardRefusalReason(
          { ...terms, maximumRewards: null },
          { ...context, referrerRewardCount: 5_000 },
        ),
      ).toBeNull();
    });
  });

  it('reports the campaign problem before the referral one', () => {
    // Both are wrong. The campaign is reported, because a paused campaign pays
    // nobody and the referral's own faults are not yet relevant.
    expect(
      awardRefusalReason({ ...terms, status: 'PAUSED' }, { ...context, selfReferral: true }),
    ).toBe('campaign is not active');
  });
});

describe('rewardIdempotencyKey', () => {
  it('is stable for the same referral and version', () => {
    expect(rewardIdempotencyKey('ref-1', 1)).toBe(rewardIdempotencyKey('ref-1', 1));
  });

  it('separates referrals', () => {
    expect(rewardIdempotencyKey('ref-1', 1)).not.toBe(rewardIdempotencyKey('ref-2', 1));
  });

  it('separates campaign versions, so new terms are a new award', () => {
    expect(rewardIdempotencyKey('ref-1', 1)).not.toBe(rewardIdempotencyKey('ref-1', 2));
  });

  it('cannot collide with a reversal key', () => {
    expect(rewardIdempotencyKey('x', 1)).not.toBe(rewardReversalIdempotencyKey('x'));
  });
});

describe('totalReleasedMinor', () => {
  it('counts only released rewards', () => {
    expect(
      totalReleasedMinor([
        { status: 'RELEASED', amountMinor: 100_000n },
        { status: 'RELEASED', amountMinor: 100_000n },
        { status: 'PENDING', amountMinor: 100_000n },
        { status: 'REJECTED', amountMinor: 100_000n },
        // A clawed-back reward is not part of the balance, and the row stays
        // rather than being deleted.
        { status: 'REVERSED', amountMinor: 100_000n },
      ]),
    ).toBe(200_000n);
  });

  it('is zero for no rewards', () => {
    expect(totalReleasedMinor([])).toBe(0n);
  });

  it('stays exact beyond the safe integer range', () => {
    const huge = 9_007_199_254_740_993n;
    expect(totalReleasedMinor([{ status: 'RELEASED', amountMinor: huge }])).toBe(huge);
  });
});
