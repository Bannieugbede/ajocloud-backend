import {
  canGrantTier,
  checkTypesApprovedBy,
  isReviewable,
  requiresReason,
  reviewStatusForDecision,
  statusAfterDecision,
} from './kyc-review-policy.js';

describe('isReviewable', () => {
  it('allows review of submitted, flagged, and expired profiles', () => {
    expect(isReviewable('PENDING')).toBe(true);
    expect(isReviewable('REQUIRES_REVIEW')).toBe(true);
    expect(isReviewable('EXPIRED')).toBe(true);
  });

  it('refuses a profile that was never submitted or is already decided', () => {
    expect(isReviewable('NOT_STARTED')).toBe(false);
    expect(isReviewable('VERIFIED')).toBe(false);
    expect(isReviewable('REJECTED')).toBe(false);
  });
});

describe('decision mapping', () => {
  it('moves the profile to the status the decision implies', () => {
    expect(statusAfterDecision('APPROVE')).toBe('VERIFIED');
    expect(statusAfterDecision('REJECT')).toBe('REJECTED');
    expect(statusAfterDecision('REQUEST_INFORMATION')).toBe('REQUIRES_REVIEW');
    expect(statusAfterDecision('ESCALATE')).toBe('REQUIRES_REVIEW');
  });

  it('records the review row distinctly even where the profile status matches', () => {
    // Both leave the profile REQUIRES_REVIEW, so only the review row preserves
    // whether an officer escalated or merely asked the applicant for more.
    expect(reviewStatusForDecision('ESCALATE')).toBe('ESCALATED');
    expect(reviewStatusForDecision('REQUEST_INFORMATION')).toBe('CLOSED');
    expect(reviewStatusForDecision('APPROVE')).toBe('APPROVED');
    expect(reviewStatusForDecision('REJECT')).toBe('REJECTED');
  });
});

describe('canGrantTier', () => {
  const evidence = (checkTypes: string[], hasNinDocument = false) => ({
    checkTypes,
    hasNinDocument,
  });

  it('grants Tier 1 without evidence', () => {
    expect(canGrantTier('TIER_1', evidence([]))).toBe(true);
  });

  it('requires a NIN check and the NIN document for Tier 2', () => {
    expect(canGrantTier('TIER_2', evidence(['NIN']))).toBe(false);
    expect(canGrantTier('TIER_2', evidence(['BVN'], true))).toBe(false);
    expect(canGrantTier('TIER_2', evidence(['NIN'], true))).toBe(true);
    expect(canGrantTier('TIER_2', evidence(['VNIN'], true))).toBe(true);
  });

  it('requires the address check as well for Tier 3', () => {
    expect(canGrantTier('TIER_3', evidence(['NIN', 'BANK_ACCOUNT'], true))).toBe(false);
    expect(canGrantTier('TIER_3', evidence(['NIN', 'ADDRESS'], true))).toBe(true);
    expect(canGrantTier('TIER_3', evidence(['ADDRESS'], true))).toBe(false);
  });
});

describe('checkTypesApprovedBy', () => {
  it('passes only the checks the granted tier rests on', () => {
    expect(checkTypesApprovedBy('TIER_1')).toEqual([]);
    expect(checkTypesApprovedBy('TIER_2')).not.toContain('ADDRESS');
    expect(checkTypesApprovedBy('TIER_3')).toContain('ADDRESS');
  });
});

describe('requiresReason', () => {
  it('demands a reason for every decision except approval', () => {
    expect(requiresReason('APPROVE')).toBe(false);
    expect(requiresReason('REJECT')).toBe(true);
    expect(requiresReason('REQUEST_INFORMATION')).toBe(true);
    expect(requiresReason('ESCALATE')).toBe(true);
  });
});
