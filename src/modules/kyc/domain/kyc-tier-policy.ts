export type KycTierName = 'TIER_1' | 'TIER_2' | 'TIER_3';

const rank: Record<KycTierName, number> = { TIER_1: 1, TIER_2: 2, TIER_3: 3 };

export function satisfiesKycTier(actual: KycTierName, required: KycTierName): boolean {
  return rank[actual] >= rank[required];
}

export function requiredTierForAction(action: string): KycTierName {
  if (
    action === 'food-coordinator.apply' ||
    action === 'withdrawal.high-value' ||
    action === 'ajo.high-value'
  ) {
    return 'TIER_3';
  }
  if (action === 'bank.link' || action === 'ajo.contribute') return 'TIER_2';
  return 'TIER_1';
}
