import type { KycStatus, KycTier } from '../../../../generated/prisma/enums.js';

export type KycReviewDecision = 'APPROVE' | 'REJECT' | 'REQUEST_INFORMATION' | 'ESCALATE';

/**
 * Which profile states a compliance officer may act on.
 *
 * A profile that has never been submitted has nothing to review, and one that is
 * already VERIFIED or REJECTED has been decided. Re-deciding a settled profile
 * silently would erase the earlier decision's reasoning from the audit trail, so
 * it is refused rather than allowed to overwrite.
 */
const reviewableStatuses: readonly KycStatus[] = ['PENDING', 'REQUIRES_REVIEW', 'EXPIRED'];

export function isReviewable(status: KycStatus): boolean {
  return reviewableStatuses.includes(status);
}

/** The profile status each decision moves the applicant to. */
export function statusAfterDecision(decision: KycReviewDecision): KycStatus {
  switch (decision) {
    case 'APPROVE':
      return 'VERIFIED';
    case 'REJECT':
      return 'REJECTED';
    case 'REQUEST_INFORMATION':
    case 'ESCALATE':
      return 'REQUIRES_REVIEW';
  }
}

/** How the decision is recorded on the ComplianceReview row. */
export function reviewStatusForDecision(
  decision: KycReviewDecision,
): 'APPROVED' | 'REJECTED' | 'ESCALATED' | 'CLOSED' {
  switch (decision) {
    case 'APPROVE':
      return 'APPROVED';
    case 'REJECT':
      return 'REJECTED';
    case 'ESCALATE':
      return 'ESCALATED';
    case 'REQUEST_INFORMATION':
      return 'CLOSED';
  }
}

/**
 * A tier is only granted when its evidence exists. Tier 2 requires a passed
 * identity check; Tier 3 additionally requires a passed bank-account check,
 * because Tier 3 unlocks coordinator approval and high-value movement.
 *
 * `passedCheckTypes` is what the profile actually has on file — approving a tier
 * the evidence does not support is the failure mode this guards against.
 */
export function canGrantTier(tier: KycTier, passedCheckTypes: readonly string[]): boolean {
  const has = (type: string) => passedCheckTypes.includes(type);
  const hasIdentity = has('BVN') || has('NIN') || has('VNIN');
  if (tier === 'TIER_1') return true;
  if (tier === 'TIER_2') return hasIdentity;
  return hasIdentity && has('BANK_ACCOUNT');
}

/**
 * A rejection or an information request must say why. The reason reaches the
 * applicant and is the compliance record of the decision, so an empty or
 * whitespace-only note is not acceptable evidence.
 */
export function requiresReason(decision: KycReviewDecision): boolean {
  return decision !== 'APPROVE';
}
