import { UnprocessableEntityException } from '@nestjs/common';
import {
  assertCoordinatorSubmission,
  canReviewCoordinatorApplication,
} from './application-policy.js';

describe('Food Coordinator application policy', () => {
  it('requires consent, terms, and settlement details on submission', () => {
    expect(() =>
      assertCoordinatorSubmission({
        status: 'DRAFT',
        hasConsent: false,
        acceptedTerms: true,
        hasSettlementDetails: true,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('allows resubmission after more information is requested', () => {
    expect(() =>
      assertCoordinatorSubmission({
        status: 'MORE_INFORMATION_REQUIRED',
        hasConsent: true,
        acceptedTerms: true,
        hasSettlementDetails: true,
      }),
    ).not.toThrow();
  });

  it('permits manual review states but not approved records', () => {
    expect(canReviewCoordinatorApplication('MANUAL_REVIEW')).toBe(true);
    expect(canReviewCoordinatorApplication('APPROVED')).toBe(false);
  });
});
