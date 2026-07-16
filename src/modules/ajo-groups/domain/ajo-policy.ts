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
