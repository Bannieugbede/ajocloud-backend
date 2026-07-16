export interface ReferralCampaignRule {
  readonly qualifyingProduct: string;
  readonly qualifyingEvent: string;
  readonly minimumTransactionCount: number;
  readonly minimumAmountMinor?: bigint;
  readonly requiredKycTier: 1 | 2 | 3;
}

export interface SettledQualifyingActivity {
  readonly product: string;
  readonly event: string;
  readonly amountMinor: bigint;
  readonly status: 'SETTLED' | 'FAILED' | 'REVERSED';
}

export function referralQualifies(input: {
  readonly selfReferral: boolean;
  readonly duplicateIdentity: boolean;
  readonly referredUserKycTier: 1 | 2 | 3;
  readonly rule: ReferralCampaignRule;
  readonly activities: readonly SettledQualifyingActivity[];
}): boolean {
  if (input.selfReferral || input.duplicateIdentity) return false;
  if (input.referredUserKycTier < input.rule.requiredKycTier) return false;
  const qualifying = input.activities.filter(
    (activity) =>
      activity.status === 'SETTLED' &&
      activity.product === input.rule.qualifyingProduct &&
      activity.event === input.rule.qualifyingEvent &&
      activity.amountMinor >= (input.rule.minimumAmountMinor ?? 0n),
  );
  return qualifying.length >= input.rule.minimumTransactionCount;
}
