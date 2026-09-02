import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { AjoGroupStatus, SwapApprovalDecision } from '../../../../generated/prisma/enums.js';

export function assertScheduleCanChange(status: AjoGroupStatus): void {
  if (status === 'LOCKED' || status === 'ACTIVE' || status === 'COMPLETED') {
    throw new ConflictException('A locked schedule is immutable');
  }
}

export function assertAllSwapApprovals(
  requiredApproverIds: readonly string[],
  approvals: readonly { approverId: string; decision: SwapApprovalDecision }[],
): void {
  const decisions = new Map(approvals.map((approval) => [approval.approverId, approval.decision]));
  if (
    requiredApproverIds.length === 0 ||
    requiredApproverIds.some((id) => decisions.get(id) !== 'APPROVED')
  ) {
    throw new UnprocessableEntityException('All required parties must approve a slot swap');
  }
}

export function assertSwapNotExpired(expiresAt: Date | null, now: Date): void {
  if (expiresAt && expiresAt <= now) {
    throw new ConflictException('Swap request has expired');
  }
}

export function assertPayoutAllowsSwap(status: string): void {
  if (['PROCESSING', 'PAID', 'FAILED', 'CANCELLED'].includes(status)) {
    throw new ConflictException('A payout for a swap position has started');
  }
}

/**
 * Resolves the per-member slot cap.
 *
 * Omitted means "no cap beyond the group's own capacity". This cannot be a
 * fixed DTO default: the database's capacity check requires
 * `maxSlotsPerMember <= maxSlots`, so any constant larger than a given group's
 * slot count makes creation fail. A default of 100 previously did exactly that
 * for every group with fewer than 100 slots.
 */
export function resolveMaxSlotsPerMember(requested: number | undefined, maxSlots: number): number {
  return requested ?? maxSlots;
}

/**
 * Checks the slot capacity rules before the database does.
 *
 * These are all enforced by `ajo_groups_capacity_check` as well, but a
 * constraint violation surfaces as an opaque 500 rather than something the
 * caller can act on.
 */
export function assertSlotCapacity(input: {
  minSlotsPerMember: number;
  maxSlotsPerMember: number;
  requestedSlots: number;
  maxSlots: number;
}): void {
  if (input.minSlotsPerMember > input.maxSlotsPerMember) {
    throw new UnprocessableEntityException('Minimum slots cannot exceed maximum slots');
  }
  if (input.maxSlotsPerMember > input.maxSlots) {
    throw new UnprocessableEntityException(
      'Maximum slots per member cannot exceed the group’s total slots',
    );
  }
  if (
    input.requestedSlots < input.minSlotsPerMember ||
    input.requestedSlots > input.maxSlotsPerMember
  ) {
    throw new UnprocessableEntityException('Requested slots violate per-member limits');
  }
  if (input.requestedSlots > input.maxSlots) {
    throw new UnprocessableEntityException('Requested slots exceed group capacity');
  }
}
