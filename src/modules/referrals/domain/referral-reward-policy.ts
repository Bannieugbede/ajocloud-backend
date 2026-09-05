/**
 * The rules governing when a referral reward may be issued, and for how much.
 *
 * A reward is the one posting in this system that creates value rather than
 * moving it: it credits a member's wallet against the platform's own funds.
 * Every rule here therefore rejects rather than defers — a reward that cannot
 * be justified is not paid, and nothing about that decision is recoverable
 * later by a retry. See ADR-012.
 */

export type CampaignTerms = {
  readonly id: string;
  readonly version: number;
  readonly status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
  readonly rewardAmountMinor: bigint;
  readonly rewardCurrency: string;
  readonly maximumRewards: number | null;
  readonly requiredKycTier: 1 | 2 | 3;
  readonly minimumAmountMinor: bigint | null;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
};

/**
 * Why a campaign cannot pay for an event at this moment, or null when it can.
 *
 * The terms in force are the terms at the qualifying event, not the terms
 * today: a deposit that settles after a campaign ends earns nothing, and one
 * that settled while it ran is unaffected by the campaign ending afterwards.
 */
export function campaignIneligibleReason(terms: CampaignTerms, occurredAt: Date): string | null {
  if (terms.status !== 'ACTIVE') return 'campaign is not active';
  if (occurredAt < terms.effectiveAt) return 'campaign had not started';
  if (terms.expiresAt && occurredAt > terms.expiresAt) return 'campaign had ended';
  if (terms.rewardAmountMinor <= 0n) return 'campaign has no reward amount';
  return null;
}

export type AwardContext = {
  readonly selfReferral: boolean;
  readonly duplicateIdentity: boolean;
  readonly referredUserKycTier: 1 | 2 | 3;
  readonly depositAmountMinor: bigint;
  readonly depositCurrency: string;
  /** Rewards already released to this referrer under this campaign. */
  readonly referrerRewardCount: number;
  readonly occurredAt: Date;
};

/**
 * Why this referral must not be rewarded, or null when it may be.
 *
 * Returns a reason rather than a boolean so the refusal can be recorded: a
 * referral rejected for duplicate identity and one rejected for an expired
 * campaign are different facts, and collapsing them to `false` loses the only
 * evidence of which control fired.
 */
export function awardRefusalReason(terms: CampaignTerms, context: AwardContext): string | null {
  const campaign = campaignIneligibleReason(terms, context.occurredAt);
  if (campaign) return campaign;

  // Fraud controls first: these describe the referral itself, and no amount of
  // qualifying activity redeems a self-referral.
  if (context.selfReferral) return 'self-referral';
  if (context.duplicateIdentity) return 'duplicate identity';
  if (context.referredUserKycTier < terms.requiredKycTier) {
    return 'referred user has not verified identity to the required tier';
  }

  // A reward is denominated in the campaign's currency. Paying a NGN reward for
  // a USD deposit would be a silent cross-currency conversion, which no rule
  // here authorises.
  if (context.depositCurrency !== terms.rewardCurrency) {
    return 'deposit currency does not match the campaign';
  }

  if (terms.minimumAmountMinor !== null && context.depositAmountMinor < terms.minimumAmountMinor) {
    return 'deposit is below the campaign minimum';
  }

  if (terms.maximumRewards !== null && context.referrerRewardCount >= terms.maximumRewards) {
    return 'referrer has reached the campaign reward cap';
  }

  return null;
}

/**
 * The key that makes an award happen at most once.
 *
 * Derived from the referral and the campaign version rather than from the
 * request, so a retried webhook, a concurrent settlement and a replayed event
 * all produce the same key and collapse onto one row. Including the version
 * means re-running a referral under genuinely new terms is a different award,
 * while re-running it under the same terms is not.
 */
export function rewardIdempotencyKey(referralId: string, campaignVersion: number): string {
  return `referral-reward:${referralId}:v${campaignVersion}`;
}

/** The key for undoing an award whose qualifying deposit was reversed. */
export function rewardReversalIdempotencyKey(rewardId: string): string {
  return `referral-reward-reversal:${rewardId}`;
}

/**
 * Sums released rewards. Kept here so the balance the app shows and the balance
 * the ledger holds are produced by one rule rather than two.
 */
export function totalReleasedMinor(
  rewards: readonly { status: string; amountMinor: bigint }[],
): bigint {
  return rewards
    .filter((reward) => reward.status === 'RELEASED')
    .reduce((total, reward) => total + reward.amountMinor, 0n);
}
