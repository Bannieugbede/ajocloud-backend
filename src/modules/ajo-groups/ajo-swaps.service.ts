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
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * Swap requests on a group, newest first, with the decisions already made.
   *
   * Without this a member had no way to discover a swap awaiting them: the
   * approve and reject routes existed but nothing listed what was pending, so
   * a request could only be acted on by someone who already knew its id.
   *
   * `awaitingMyDecision` is computed here rather than left to the client, since
   * it depends on who owns the two affected slots — which the client would
   * otherwise have to re-derive and could get wrong.
   */
  async list(userId: string, groupId: string): Promise<unknown> {
    const membership = await this.prisma.ajoGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { id: true, status: true },
    });
    if (!membership || membership.status !== AjoMemberStatus.ACTIVE) {
      throw new ForbiddenException('You do not have access to this group');
    }

    const swaps = await this.prisma.swapRequest.findMany({
      where: { groupId },
      select: {
        id: true,
        status: true,
        initiatorType: true,
        requestedByMemberId: true,
        fromSlotId: true,
        toSlotId: true,
        originalFromPosition: true,
        originalToPosition: true,
        proposedFromPosition: true,
        proposedToPosition: true,
        reason: true,
        expiresAt: true,
        decidedAt: true,
        executedAt: true,
        createdAt: true,
        approvals: {
          select: {
            approverMemberId: true,
            decision: true,
            reason: true,
            decidedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const slotIds = [...new Set(swaps.flatMap((swap) => [swap.fromSlotId, swap.toSlotId]))];
    const slots = await this.prisma.ajoSlot.findMany({
      where: { id: { in: slotIds } },
      select: { id: true, position: true, memberId: true },
    });
    const members = await this.prisma.ajoGroupMember.findMany({
      where: { id: { in: slots.map((slot) => slot.memberId) } },
      select: { id: true, userId: true },
    });
    // AjoGroupMember stores userId without a User relation, so names are read
    // separately. Only the display name is exposed: a member's email is not
    // something other members of a group are entitled to see.
    const profiles = await this.prisma.userProfile.findMany({
      where: { userId: { in: members.map((member) => member.userId) } },
      select: { userId: true, firstName: true, lastName: true },
    });
    const nameByUserId = new Map(
      profiles.map((profile) => [
        profile.userId,
        `${profile.firstName} ${profile.lastName}`.trim(),
      ]),
    );
    const userIdByMemberId = new Map(members.map((member) => [member.id, member.userId]));
    const slotById = new Map(slots.map((slot) => [slot.id, slot]));
    const describe = (slotId: string) => {
      const slot = slotById.get(slotId);
      const userId = slot ? userIdByMemberId.get(slot.memberId) : undefined;
      return {
        slotId,
        position: slot?.position ?? null,
        memberId: slot?.memberId ?? null,
        displayName: (userId ? nameByUserId.get(userId) : undefined) ?? 'Member',
      };
    };

    const now = new Date();
    return swaps.map((swap) => {
      const owners = [swap.fromSlotId, swap.toSlotId]
        .map((slotId) => slotById.get(slotId)?.memberId)
        .filter((memberId): memberId is string => Boolean(memberId));
      const decided = swap.approvals.some(
        (approval) => approval.approverMemberId === membership.id,
      );
      // An expired request is reported as expired even before the row is
      // rewritten, so the list never invites a decision that would be refused.
      const expired = Boolean(swap.expiresAt && swap.expiresAt <= now);
      const status =
        swap.status === SwapRequestStatus.PENDING && expired
          ? SwapRequestStatus.EXPIRED
          : swap.status;
      return {
        ...swap,
        status,
        from: describe(swap.fromSlotId),
        to: describe(swap.toSlotId),
        awaitingMyDecision:
          status === SwapRequestStatus.PENDING && owners.includes(membership.id) && !decided,
      };
    });
  }

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
