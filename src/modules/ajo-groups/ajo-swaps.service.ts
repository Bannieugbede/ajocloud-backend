import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AjoGroupStatus,
  AjoMemberRole,
  AjoMemberStatus,
  ContributionScheduleStatus,
  PayoutScheduleStatus,
  SwapApprovalDecision,
  SwapInitiatorType,
  SwapRequestStatus,
} from '../../../generated/prisma/enums.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import { assessVersionedFee } from '../fees/domain/fee-rule.js';
import {
  assertAllSwapApprovals,
  assertPayoutAllowsSwap,
  assertSwapNotExpired,
} from './domain/ajo-policy.js';
import type { CreateSwapRequestDto, DecideSwapRequestDto } from './dto/create-swap-request.dto.js';

@Injectable()
export class AjoSwapsService {
  constructor(private readonly transactions: TransactionService) {}

  async create(userId: string, groupId: string, dto: CreateSwapRequestDto): Promise<unknown> {
    if (dto.fromSlotId === dto.toSlotId) {
      throw new UnprocessableEntityException('Swap positions must be different');
    }
    return this.transactions.serializable(async (tx) => {
      const membership = await tx.ajoGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!membership || membership.status !== AjoMemberStatus.ACTIVE) {
        throw new ForbiddenException('Active group membership is required');
      }
      const group = await tx.ajoGroup.findUnique({
        where: { id: groupId },
        include: {
          slots: {
            where: { id: { in: [dto.fromSlotId, dto.toSlotId] } },
            include: { member: true },
          },
        },
      });
      if (!group) throw new NotFoundException('Ajo group was not found');
      if (group.status !== AjoGroupStatus.LOCKED && group.status !== AjoGroupStatus.ACTIVE) {
        throw new ConflictException('Group does not permit swaps');
      }
      if (
        group.slots.length !== 2 ||
        group.slots.some((slot) => slot.member.status !== AjoMemberStatus.ACTIVE)
      ) {
        throw new ConflictException('Both swap positions require unrestricted active owners');
      }
      const from = group.slots.find((slot) => slot.id === dto.fromSlotId);
      const to = group.slots.find((slot) => slot.id === dto.toSlotId);
      if (!from || !to) throw new NotFoundException('Swap slot was not found in this group');
      const isAdmin = membership.role === AjoMemberRole.GROUP_ADMIN;
      if (!isAdmin && from.memberId !== membership.id) {
        throw new ForbiddenException('Members can initiate swaps only from their own position');
      }
      const conflict = await tx.swapRequest.findFirst({
        where: {
          groupId,
          status: SwapRequestStatus.PENDING,
          OR: [{ fromSlotId: { in: [from.id, to.id] } }, { toSlotId: { in: [from.id, to.id] } }],
        },
      });
      if (conflict) throw new ConflictException('A conflicting swap request already exists');
      const prohibitedPayout = await tx.payoutSchedule.findFirst({
        where: {
          groupId,
          scheduleVersion: group.scheduleVersion,
          slotId: { in: [from.id, to.id] },
          status: {
            in: [
              PayoutScheduleStatus.PROCESSING,
              PayoutScheduleStatus.PAID,
              PayoutScheduleStatus.FAILED,
              PayoutScheduleStatus.CANCELLED,
            ],
          },
        },
      });
      if (prohibitedPayout) assertPayoutAllowsSwap(prohibitedPayout.status);
      const overdue = await tx.contributionSchedule.findFirst({
        where: {
          groupId,
          slotId: { in: [from.id, to.id] },
          status: ContributionScheduleStatus.OVERDUE,
        },
      });
      if (overdue) throw new ConflictException('An affected member has an overdue contribution');
      const expiresAt = new Date(Date.now() + 72 * 60 * 60_000);
      const swap = await tx.swapRequest.create({
        data: {
          groupId,
          requestedByMemberId: membership.id,
          initiatedByUserId: userId,
          initiatorType: isAdmin ? SwapInitiatorType.ADMINISTRATOR : SwapInitiatorType.MEMBER,
          fromSlotId: from.id,
          toSlotId: to.id,
          originalFromPosition: from.position,
          originalToPosition: to.position,
          proposedFromPosition: to.position,
          proposedToPosition: from.position,
          previousScheduleVersion: group.scheduleVersion,
          scheduleVersion: group.scheduleVersion,
          expiresAt,
          ...(dto.reason ? { reason: dto.reason } : {}),
        },
      });
      await this.assessFee(tx, swap.id, userId, group.currency, group.baseContributionMinor);
      await this.recordEvent(tx, userId, groupId, swap.id, 'ajo.swap.requested');
      return swap;
    });
  }

  async approve(
    userId: string,
    groupId: string,
    swapId: string,
    dto: DecideSwapRequestDto,
  ): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const swap = await this.requirePending(tx, groupId, swapId);
      const membership = await tx.ajoGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!membership || membership.status !== AjoMemberStatus.ACTIVE) {
        throw new ForbiddenException('Active group membership is required');
      }
      const slots = await tx.ajoSlot.findMany({
        where: { id: { in: [swap.fromSlotId, swap.toSlotId] } },
      });
      const requiredApprovers = [...new Set(slots.map((slot) => slot.memberId))];
      if (!requiredApprovers.includes(membership.id)) {
        throw new ForbiddenException('Only an affected position owner can approve');
      }
      await tx.swapApproval.upsert({
        where: {
          swapRequestId_approverMemberId: {
            swapRequestId: swap.id,
            approverMemberId: membership.id,
          },
        },
        create: {
          swapRequestId: swap.id,
          approverMemberId: membership.id,
          decision: SwapApprovalDecision.APPROVED,
          ...(dto.reason ? { reason: dto.reason } : {}),
        },
        update: {
          decision: SwapApprovalDecision.APPROVED,
          decidedAt: new Date(),
          ...(dto.reason ? { reason: dto.reason } : {}),
        },
      });
      const approvals = await tx.swapApproval.findMany({ where: { swapRequestId: swap.id } });
      if (
        requiredApprovers.every((id) =>
          approvals.some(
            (entry) =>
              entry.approverMemberId === id && entry.decision === SwapApprovalDecision.APPROVED,
          ),
        )
      ) {
        assertAllSwapApprovals(
          requiredApprovers,
          approvals.map((entry) => ({
            approverId: entry.approverMemberId,
            decision: entry.decision,
          })),
        );
        return this.execute(tx, userId, swap.id);
      }
      await this.recordEvent(tx, userId, groupId, swap.id, 'ajo.swap.approved');
      return tx.swapRequest.findUnique({ where: { id: swap.id }, include: { approvals: true } });
    });
  }

  async reject(
    userId: string,
    groupId: string,
    swapId: string,
    dto: DecideSwapRequestDto,
  ): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const swap = await this.requirePending(tx, groupId, swapId);
      const membership = await tx.ajoGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!membership) throw new ForbiddenException('Group membership is required');
      const slot = await tx.ajoSlot.findFirst({
        where: { id: { in: [swap.fromSlotId, swap.toSlotId] }, memberId: membership.id },
      });
      if (!slot && membership.role !== AjoMemberRole.GROUP_ADMIN) {
        throw new ForbiddenException('Only an affected owner or administrator can reject');
      }
      await tx.swapApproval.upsert({
        where: {
          swapRequestId_approverMemberId: {
            swapRequestId: swap.id,
            approverMemberId: membership.id,
          },
        },
        create: {
          swapRequestId: swap.id,
          approverMemberId: membership.id,
          decision: SwapApprovalDecision.REJECTED,
          ...(dto.reason ? { reason: dto.reason } : {}),
        },
        update: {
          decision: SwapApprovalDecision.REJECTED,
          decidedAt: new Date(),
          ...(dto.reason ? { reason: dto.reason } : {}),
        },
      });
      const rejected = await tx.swapRequest.update({
        where: { id: swap.id },
        data: { status: SwapRequestStatus.REJECTED, decidedAt: new Date() },
      });
      await this.recordEvent(tx, userId, groupId, swap.id, 'ajo.swap.rejected');
      return rejected;
    });
  }

  private async execute(tx: TransactionClient, userId: string, swapId: string): Promise<unknown> {
    const swap = await tx.swapRequest.findUnique({
      where: { id: swapId },
      include: { group: true },
    });
    if (!swap || swap.status !== SwapRequestStatus.PENDING) {
      throw new ConflictException('Swap is no longer pending');
    }
    if (swap.group.status === AjoGroupStatus.SUSPENDED) {
      throw new ConflictException('Suspended groups cannot execute swaps');
    }
    if (swap.group.scheduleVersion !== swap.previousScheduleVersion) {
      throw new ConflictException('Schedule changed after this swap was requested');
    }
    const current = await tx.payoutSchedule.findMany({
      where: { groupId: swap.groupId, scheduleVersion: swap.previousScheduleVersion },
      orderBy: { dueAt: 'asc' },
    });
    if (current.length === 0) throw new ConflictException('Current payout schedule is missing');
    const nextVersion = swap.previousScheduleVersion + 1;
    await tx.payoutSchedule.createMany({
      data: current.map((entry) => ({
        groupId: entry.groupId,
        cycleId: entry.cycleId,
        slotId:
          entry.slotId === swap.fromSlotId
            ? swap.toSlotId
            : entry.slotId === swap.toSlotId
              ? swap.fromSlotId
              : entry.slotId,
        amountDueMinor: entry.amountDueMinor,
        amountPaidMinor: 0n,
        currency: entry.currency,
        dueAt: entry.dueAt,
        status: PayoutScheduleStatus.PENDING,
        scheduleVersion: nextVersion,
        immutableAt: new Date(),
      })),
    });
    const previous = await tx.ajoScheduleVersion.findUnique({
      where: { groupId_version: { groupId: swap.groupId, version: swap.previousScheduleVersion } },
    });
    await tx.ajoScheduleVersion.create({
      data: {
        groupId: swap.groupId,
        version: nextVersion,
        ...(previous ? { previousVersionId: previous.id } : {}),
        reason: 'APPROVED_SWAP',
        createdByUserId: userId,
        snapshot: {
          swapId: swap.id,
          previousVersion: swap.previousScheduleVersion,
          fromSlotId: swap.fromSlotId,
          toSlotId: swap.toSlotId,
          originalFromPosition: swap.originalFromPosition,
          originalToPosition: swap.originalToPosition,
        },
      },
    });
    await tx.ajoGroup.update({
      where: { id: swap.groupId },
      data: { scheduleVersion: nextVersion },
    });
    const executed = await tx.swapRequest.update({
      where: { id: swap.id },
      data: {
        status: SwapRequestStatus.EXECUTED,
        resultingScheduleVersion: nextVersion,
        decidedAt: new Date(),
        executedAt: new Date(),
      },
    });
    await this.recordEvent(tx, userId, swap.groupId, swap.id, 'ajo.swap.executed');
    return executed;
  }

  private async requirePending(tx: TransactionClient, groupId: string, swapId: string) {
    const swap = await tx.swapRequest.findFirst({ where: { id: swapId, groupId } });
    if (!swap) throw new NotFoundException('Swap request was not found');
    if (swap.status !== SwapRequestStatus.PENDING) {
      throw new ConflictException('Swap request is no longer pending');
    }
    if (swap.expiresAt && swap.expiresAt <= new Date()) {
      await tx.swapRequest.update({
        where: { id: swap.id },
        data: { status: SwapRequestStatus.EXPIRED, decidedAt: new Date() },
      });
      assertSwapNotExpired(swap.expiresAt, new Date());
    }
    return swap;
  }

  private async assessFee(
    tx: TransactionClient,
    swapId: string,
    userId: string,
    currency: string,
    calculationBaseMinor: bigint,
  ): Promise<void> {
    const definition = await tx.feeDefinition.findFirst({
      where: {
        code: 'AJO_SWAP',
        isActive: true,
        effectiveAt: { lte: new Date() },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { version: 'desc' },
    });
    if (!definition) return;
    const assessed = assessVersionedFee(definition, calculationBaseMinor);
    const assessment = await tx.feeAssessment.create({
      data: {
        feeDefinitionId: definition.id,
        subjectType: 'SwapRequest',
        subjectId: swapId,
        amountMinor: assessed.amountMinor,
        currency,
        calculationBaseMinor,
        ruleSnapshot: {
          ...assessed.snapshot,
          assessedForUserId: userId,
        },
      },
    });
    await tx.swapRequest.update({
      where: { id: swapId },
      data: { feeAssessmentId: assessment.id },
    });
  }

  private async recordEvent(
    tx: TransactionClient,
    actorUserId: string,
    groupId: string,
    swapId: string,
    eventType: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: eventType,
        subjectType: 'SwapRequest',
        subjectId: swapId,
        groupId,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'SwapRequest',
        aggregateId: swapId,
        eventType,
        payload: { groupId, swapId },
      },
    });
  }
}
