import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

export function assertCoordinatorSubmission(input: {
  readonly status: string;
  readonly hasConsent: boolean;
  readonly acceptedTerms: boolean;
  readonly hasSettlementDetails: boolean;
}): void {
  if (input.status !== 'DRAFT' && input.status !== 'MORE_INFORMATION_REQUIRED') {
    throw new ConflictException('Application cannot be submitted in its current state');
  }
  if (!input.hasConsent || !input.acceptedTerms || !input.hasSettlementDetails) {
    throw new UnprocessableEntityException('Application requirements are incomplete');
  }
}

export function canReviewCoordinatorApplication(status: string): boolean {
  return ['SUBMITTED', 'AUTOMATED_REVIEW', 'MANUAL_REVIEW', 'MORE_INFORMATION_REQUIRED'].includes(
    status,
  );
}
