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
 * A tier is only granted when its evidence exists (ADR-015). Tier 2 needs a NIN
 * check and the NIN document; Tier 3 additionally needs an address check.
 *
 * `checkTypes` counts checks that passed or are held for this review, since
 * approving is exactly what passes a held one. Approving a tier the evidence
 * does not support is the failure mode this guards against.
 */
export function canGrantTier(
  tier: KycTier,
  evidence: { readonly checkTypes: readonly string[]; readonly hasNinDocument: boolean },
): boolean {
  const has = (type: string) => evidence.checkTypes.includes(type);
  const stage2 = (has('NIN') || has('VNIN')) && evidence.hasNinDocument;
  if (tier === 'TIER_1') return true;
  if (tier === 'TIER_2') return stage2;
  return stage2 && has('ADDRESS');
}

/** Checks an approval of `tier` passes, if they are held for review. */
export function checkTypesApprovedBy(tier: KycTier): readonly ('NIN' | 'VNIN' | 'ADDRESS')[] {
  if (tier === 'TIER_1') return [];
  if (tier === 'TIER_2') return ['NIN', 'VNIN'];
  return ['NIN', 'VNIN', 'ADDRESS'];
}

/**
 * A rejection or an information request must say why. The reason reaches the
 * applicant and is the compliance record of the decision, so an empty or
 * whitespace-only note is not acceptable evidence.
 */
export function requiresReason(decision: KycReviewDecision): boolean {
  return decision !== 'APPROVE';
}
