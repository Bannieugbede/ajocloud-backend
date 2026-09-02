import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';

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

/** A programme takes subscribers only while it is open for enrolment. */
export function acceptsSubscriptions(status: string): boolean {
  return status === 'OPEN';
}

/**
 * Checks a subscription request before it is written.
 *
 * Capacity counts subscriptions, not people: one member taking three portions
 * consumes three places, so a programme cannot be oversubscribed by a member
 * increasing their quantity.
 */
export function assertCanSubscribe(input: {
  readonly status: string;
  readonly capacity: number;
  readonly enrolled: number;
  readonly quantity: number;
  readonly packageBelongsToProgramme: boolean;
  readonly packageIsActive: boolean;
  readonly alreadySubscribed: boolean;
}): void {
  if (!acceptsSubscriptions(input.status)) {
    throw new UnprocessableEntityException('This programme is not open for enrolment');
  }
  if (!input.packageBelongsToProgramme) {
    throw new UnprocessableEntityException('That package is not part of this programme');
  }
  if (!input.packageIsActive) {
    throw new UnprocessableEntityException('That package is no longer available');
  }
  if (input.alreadySubscribed) {
    throw new ConflictException('You have already enrolled in this package');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new UnprocessableEntityException('Quantity must be at least one');
  }
  if (input.enrolled + input.quantity > input.capacity) {
    throw new ConflictException('This programme is full');
  }
}

/** Places left, never negative even if capacity was reduced after enrolment. */
export function remainingCapacity(capacity: number, enrolled: number): number {
  return Math.max(0, capacity - enrolled);
}

/** Only a subscription that has not been fulfilled may be withdrawn. */
export function canCancelSubscription(status: string): boolean {
  return status === 'PENDING' || status === 'ACTIVE';
}
