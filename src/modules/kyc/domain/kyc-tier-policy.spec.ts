import { requiredTierForAction, satisfiesKycTier } from './kyc-tier-policy.js';

describe('progressive KYC tiers', () => {
  it('requires Tier 3 for Food Coordinator approval and high-value actions', () => {
    expect(requiredTierForAction('food-coordinator.apply')).toBe('TIER_3');
    expect(satisfiesKycTier('TIER_2', 'TIER_3')).toBe(false);
  });

  it('allows a higher tier to satisfy a lower requirement', () => {
    expect(satisfiesKycTier('TIER_3', 'TIER_2')).toBe(true);
  });
});
