import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';

export function assertCoordinatorCanCreateProgramme(input: {
  readonly applicationStatus: string;
  readonly approvalExpiresAt?: Date;
  readonly kycTier: string;
}): void {
  if (
    input.applicationStatus !== 'APPROVED' ||
    !input.approvalExpiresAt ||
    input.approvalExpiresAt <= new Date() ||
    input.kycTier !== 'TIER_3'
  ) {
    throw new ForbiddenException('An approved, current Tier 3 coordinator is required');
  }
}

export function assertPackageActivation(input: {
  readonly priceMinor: bigint;
  readonly capacity: number;
  readonly enrolled: number;
}): void {
  if (input.priceMinor <= 0n)
    throw new UnprocessableEntityException('Package price must be positive');
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.enrolled > input.capacity) {
    throw new UnprocessableEntityException('Package capacity is invalid');
  }
}

export function canConsumeDistributionToken(input: {
  readonly expiresAt: Date;
  readonly usedAt?: Date;
  readonly now: Date;
}): boolean {
  return !input.usedAt && input.expiresAt > input.now;
}
