import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
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

/**
 * Programme lifecycle transitions a coordinator may make.
 *
 * DRAFT is a private working state: the programme is built and checked before
 * anyone can see it. OPEN accepts enrolment. ACTIVE means procurement has
 * started, which is why `acceptsSubscriptions` refuses it — a member joining
 * after the food was bought would not be in what was purchased.
 *
 * COMPLETED and CANCELLED are terminal. Reopening a completed programme would
 * let a coordinator collect against a cycle they have already distributed and
 * reconciled.
 */
export function canTransitionProgramme(from: string, to: string): boolean {
  if (from === 'DRAFT') return to === 'OPEN' || to === 'CANCELLED';
  if (from === 'OPEN') return to === 'ACTIVE' || to === 'CANCELLED' || to === 'SUSPENDED';
  if (from === 'ACTIVE') return to === 'COMPLETED' || to === 'SUSPENDED';
  // A suspended programme returns to the state it can safely resume in; it
  // cannot jump forward to COMPLETED without going back through ACTIVE.
  if (from === 'SUSPENDED') return to === 'OPEN' || to === 'ACTIVE' || to === 'CANCELLED';
  return false;
}

/**
 * Opening a programme fixes its package prices. A member enrols against a
 * displayed price, so letting the coordinator edit it afterwards would change
 * what somebody already agreed to pay.
 */
export function assertCanOpenProgramme(input: {
  readonly status: string;
  readonly packages: readonly { readonly priceMinor: bigint; readonly isActive: boolean }[];
  readonly enrolmentCapacity: number;
}): void {
  if (!canTransitionProgramme(input.status, 'OPEN')) {
    throw new ConflictException('This programme cannot be opened from its current state');
  }
  const active = input.packages.filter((foodPackage) => foodPackage.isActive);
  if (active.length === 0) {
    throw new UnprocessableEntityException('A programme needs at least one active package');
  }
  for (const foodPackage of active) {
    assertPackageActivation({
      priceMinor: foodPackage.priceMinor,
      capacity: input.enrolmentCapacity,
      enrolled: 0,
    });
  }
}

/**
 * A locked package is the price a member agreed to. It is editable only while
 * the programme is still a draft and the lock has not been taken.
 */
export function assertPackageEditable(input: {
  readonly programmeStatus: string;
  readonly priceLockedAt?: Date | null;
}): void {
  if (input.priceLockedAt) {
    throw new ConflictException('This package price is locked and cannot be changed');
  }
  if (input.programmeStatus !== 'DRAFT') {
    throw new ConflictException('Packages can only be changed while the programme is a draft');
  }
}

/**
 * Procurement may begin once enrolment has closed against a real subscriber
 * list. Ordering while the programme is still OPEN would buy for a headcount
 * that can still change under the coordinator.
 */
export function assertCanProcure(input: {
  readonly status: string;
  readonly subscribedPortions: number;
}): void {
  if (input.status !== 'ACTIVE') {
    throw new ConflictException('Procurement starts once the programme is active');
  }
  if (input.subscribedPortions < 1) {
    throw new UnprocessableEntityException('This programme has no enrolments to procure for');
  }
}

/**
 * Purchase-order transitions. A submitted order is with the vendor; a confirmed
 * one has been accepted and priced; fulfilled means goods were received against
 * a receipt.
 */
export function canTransitionPurchaseOrder(from: string, to: string): boolean {
  if (from === 'DRAFT') return to === 'SUBMITTED' || to === 'CANCELLED';
  if (from === 'SUBMITTED') return to === 'CONFIRMED' || to === 'CANCELLED';
  // Cancelling a confirmed order is refused here: the vendor has committed, so
  // unwinding it is a commercial conversation, not a status flip.
  if (from === 'CONFIRMED') return to === 'FULFILLED';
  return false;
}

/**
 * An order may only be sent to a vendor the platform has verified. An
 * unverified vendor has not been checked, and procurement spends members'
 * contributions.
 */
export function assertVendorUsable(input: {
  readonly exists: boolean;
  readonly isVerified: boolean;
}): void {
  if (!input.exists) throw new NotFoundException('That vendor was not found');
  if (!input.isVerified) {
    throw new UnprocessableEntityException('That vendor has not been verified');
  }
}

/** Order total from its lines, in minor units so no float rounding occurs. */
export function purchaseOrderTotalMinor(
  items: readonly { readonly quantity: string; readonly unitPriceMinor: bigint }[],
): bigint {
  return items.reduce(
    (total, item) => total + scaleByQuantity(item.unitPriceMinor, item.quantity),
    0n,
  );
}

/**
 * Multiplies a minor-unit price by a decimal quantity such as `2.500` without
 * going through a float. The quantity is scaled to thousandths (the column's
 * precision), multiplied, then divided back down, rounding half up so the
 * vendor is never systematically underpaid.
 */
export function scaleByQuantity(unitPriceMinor: bigint, quantity: string): bigint {
  const [whole = '0', fraction = ''] = quantity.split('.');
  const thousandths = BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
  const scaled = unitPriceMinor * thousandths;
  const remainder = scaled % 1000n;
  return scaled / 1000n + (remainder * 2n >= 1000n ? 1n : 0n);
}

/**
 * Distribution transitions. READY means the goods are in hand and members can
 * be told to collect, which is why a distribution cannot be planned straight
 * into DISTRIBUTING.
 */
export function canTransitionDistribution(from: string, to: string): boolean {
  if (from === 'PLANNED') return to === 'READY' || to === 'CANCELLED';
  if (from === 'READY') return to === 'DISTRIBUTING' || to === 'CANCELLED';
  if (from === 'DISTRIBUTING') return to === 'COMPLETED';
  return false;
}

/**
 * A distribution can only be created once the goods exist to distribute: an
 * order that has been fulfilled against a receipt.
 */
export function assertCanPlanDistribution(input: {
  readonly programmeStatus: string;
  readonly fulfilledOrders: number;
  readonly scheduledAt: Date;
  readonly now: Date;
}): void {
  if (input.programmeStatus !== 'ACTIVE') {
    throw new ConflictException('Only an active programme can schedule a distribution');
  }
  if (input.fulfilledOrders < 1) {
    throw new UnprocessableEntityException('No fulfilled purchase order to distribute from');
  }
  if (input.scheduledAt <= input.now) {
    throw new UnprocessableEntityException('The distribution must be scheduled in the future');
  }
}

/** Collection is only claimable while the goods are actually being handed out. */
export function assertCanConfirmCollection(input: {
  readonly distributionStatus: string;
  readonly alreadyConfirmed: boolean;
}): void {
  if (input.distributionStatus !== 'DISTRIBUTING') {
    throw new ConflictException('This distribution is not currently handing out');
  }
  if (input.alreadyConfirmed) {
    throw new ConflictException('This collection has already been confirmed');
  }
}

/**
 * A programme is only complete when every member who was owed goods has
 * collected them. Closing with outstanding items would erase the record that
 * somebody never received what they paid for.
 */
export function assertCanCompleteProgramme(input: {
  readonly status: string;
  readonly outstandingCollections: number;
}): void {
  if (!canTransitionProgramme(input.status, 'COMPLETED')) {
    throw new ConflictException('This programme cannot be completed from its current state');
  }
  if (input.outstandingCollections > 0) {
    throw new ConflictException(
      `${input.outstandingCollections} member collections are still outstanding`,
    );
  }
}

/**
 * Collection codes are read aloud at a distribution point and typed by hand, so
 * ambiguous characters are excluded. Only a digest is stored: a leaked database
 * must not yield a set of codes that can be used to collect other people's food.
 */
const COLLECTION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** How long a collection code stays valid. Long enough to reach the front of a
    queue, short enough that a screenshot is not a standing entitlement. */
export const COLLECTION_CODE_TTL_MS = 30 * 60 * 1000;

export function generateCollectionCode(randomBytes: Uint8Array): string {
  return [...randomBytes.slice(0, 6)]
    .map((byte) => COLLECTION_CODE_ALPHABET[byte % COLLECTION_CODE_ALPHABET.length])
    .join('');
}

/** Codes are compared case-insensitively with spacing and dashes ignored. */
export function normalizeCollectionCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function isValidCollectionCodeShape(code: string): boolean {
  const normalized = normalizeCollectionCode(code);
  return (
    normalized.length === 6 && [...normalized].every((c) => COLLECTION_CODE_ALPHABET.includes(c))
  );
}
