import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  AjoCycleStatus,
  AjoContributionMode,
  AjoGroupStatus,
  AjoMemberRole,
  AjoMemberStatus,
  AjoSlotStatus,
  ContributionScheduleStatus,
  GroupInvitationStatus,
  PayoutScheduleStatus,
} from '../../../generated/prisma/enums.js';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { assertSlotCapacity, resolveMaxSlotsPerMember } from './domain/ajo-policy.js';
import { digestInvitationCode } from './domain/invitation-code.js';
import { assertAjoGroupBounds, generateRotationSchedule } from './domain/ajo-schedule.js';
import type { CreateAjoGroupDto } from './dto/create-ajo-group.dto.js';
import type { JoinAjoGroupDto } from './dto/join-ajo-group.dto.js';

@Injectable()
export class AjoGroupsService {
  private readonly tokenPepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    config: ConfigService<Environment, true>,
  ) {
    this.tokenPepper = config.get('TOKEN_PEPPER', { infer: true });
  }

  async create(userId: string, dto: CreateAjoGroupDto): Promise<Record<string, unknown>> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    assertAjoGroupBounds(startDate, endDate, dto.maxSlots);
    const maxSlotsPerMember = resolveMaxSlotsPerMember(dto.maxSlotsPerMember, dto.maxSlots);
    assertSlotCapacity({
      minSlotsPerMember: dto.minSlotsPerMember,
      maxSlotsPerMember,
      requestedSlots: dto.requestedSlots,
      maxSlots: dto.maxSlots,
    });
    const contributionUnitMinor =
      dto.contributionMode === AjoContributionMode.FLEXIBLE_UNIT
        ? dto.contributionUnitMinor
        : dto.baseContributionMinor;
    if (!contributionUnitMinor) {
      throw new UnprocessableEntityException('Flexible Ajo requires a contribution unit');
    }
    const unitMinor = BigInt(contributionUnitMinor);
    const invitationCode = randomBytes(32).toString('base64url');
    const tokenDigest = this.digest(invitationCode);
    const created = await this.transactions.serializable(async (tx) => {
      const group = await tx.ajoGroup.create({
        data: {
          name: dto.name.trim(),
          contributionFrequency: dto.contributionFrequency,
          contributionMode: dto.contributionMode,
          baseContributionMinor: unitMinor,
          contributionUnitMinor:
            dto.contributionMode === AjoContributionMode.FLEXIBLE_UNIT ? unitMinor : null,
          currency: 'NGN',
          maxMembers: dto.maxMembers,
          maxSlots: dto.maxSlots,
          minSlotsPerMember: dto.minSlotsPerMember,
          maxSlotsPerMember,
          businessTimezone: dto.businessTimezone,
          contributionOpenOffsetMinutes: dto.contributionOpenOffsetMinutes,
          contributionCloseOffsetMinutes: dto.contributionCloseOffsetMinutes,
          gracePeriodMinutes: dto.gracePeriodMinutes,
          lateThresholdMinutes: dto.lateThresholdMinutes,
          payoutEligibilityCutoffMinutes: dto.payoutEligibilityCutoffMinutes,
          payoutOffsetMinutes: dto.payoutOffsetMinutes,
          payoutProcessingWindowMinutes: dto.payoutProcessingWindowMinutes,
          startDate,
          endDate,
          createdByUserId: userId,
        },
      });
      const admin = await tx.ajoGroupMember.create({
        data: {
          groupId: group.id,
          userId,
          role: AjoMemberRole.GROUP_ADMIN,
          status: AjoMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      });
      await tx.ajoSlot.createMany({
        data: Array.from({ length: dto.requestedSlots }, (_, index) => ({
          groupId: group.id,
          memberId: admin.id,
          position: index + 1,
          status: AjoSlotStatus.RESERVED,
        })),
      });
      await tx.ajoContributionPlan.create({
        data: {
          groupId: group.id,
          memberId: admin.id,
          contributionUnitMinor: unitMinor,
          unitQuantity: dto.requestedSlots,
          expectedPerCycleMinor: unitMinor * BigInt(dto.requestedSlots),
          totalExpectedMinor: 0n,
          outstandingMinor: 0n,
          expectedEntitlementMinor: unitMinor * BigInt(dto.requestedSlots),
          currency: group.currency,
        },
      });
      await tx.groupInvitation.create({
        data: {
          groupId: group.id,
          createdByMemberId: admin.id,
          tokenDigest,
          maxUses: dto.maxSlots - dto.requestedSlots,
          expiresAt: startDate,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ajo.group.created',
          subjectType: 'AjoGroup',
          subjectId: group.id,
          groupId: group.id,
        },
      });
      return group;
    });
    return { id: created.id, name: created.name, status: created.status, invitationCode };
  }

  async list(userId: string): Promise<unknown[]> {
    return this.prisma.ajoGroup.findMany({
      where: { members: { some: { userId, status: AjoMemberStatus.ACTIVE } }, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        contributionFrequency: true,
        contributionMode: true,
        baseContributionMinor: true,
        currency: true,
        maxSlots: true,
        maxMembers: true,
        startDate: true,
        endDate: true,
        _count: { select: { slots: true, members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(userId: string, groupId: string): Promise<unknown> {
    await this.requireMembership(userId, groupId);
    const group = await this.prisma.ajoGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        contributionFrequency: true,
        contributionMode: true,
        baseContributionMinor: true,
        currency: true,
        maxSlots: true,
        maxMembers: true,
        minSlotsPerMember: true,
        maxSlotsPerMember: true,
        businessTimezone: true,
        startDate: true,
        endDate: true,
        lockedAt: true,
        members: {
          select: {
            id: true,
            userId: true,
            role: true,
            status: true,
            _count: { select: { slots: true } },
          },
        },
        // Positions are the rotation order, and a swap is expressed as a pair of
        // slot ids, so both are needed before either screen can be built.
        slots: {
          select: { id: true, memberId: true, position: true, status: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException('Ajo group was not found');

    // AjoGroupMember stores userId without a User relation, so names are read
    // separately. Only the display name is exposed: a member's email is not
    // something other members of a group are entitled to see.
    const profiles = await this.prisma.userProfile.findMany({
      where: { userId: { in: group.members.map((member) => member.userId) } },
      select: { userId: true, firstName: true, lastName: true },
    });
    const nameByUserId = new Map(
      profiles.map((profile) => [
        profile.userId,
        `${profile.firstName} ${profile.lastName}`.trim(),
      ]),
    );
    return {
      ...group,
      members: group.members.map((member) => ({
        ...member,
        displayName: nameByUserId.get(member.userId) ?? 'Member',
      })),
    };
  }

  async join(userId: string, groupId: string, dto: JoinAjoGroupDto): Promise<unknown> {
    const digest = this.digest(dto.invitationCode);
    return this.transactions.serializable(async (tx) => {
      const group = await tx.ajoGroup.findUnique({
        where: { id: groupId },
        include: {
          _count: {
            select: {
              slots: true,
              members: { where: { status: AjoMemberStatus.ACTIVE } },
            },
          },
        },
      });
      if (!group) throw new NotFoundException('Ajo group was not found');
      if (group.status !== AjoGroupStatus.DRAFT && group.status !== AjoGroupStatus.OPEN) {
        throw new ConflictException('This group no longer accepts members');
      }
      const invitation = await tx.groupInvitation.findUnique({ where: { tokenDigest: digest } });
      if (
        !invitation ||
        invitation.groupId !== groupId ||
        invitation.status !== GroupInvitationStatus.ACTIVE ||
        invitation.expiresAt <= new Date() ||
        invitation.useCount >= invitation.maxUses
      ) {
        throw new ForbiddenException('Invitation is invalid or expired');
      }
      if (group._count.slots + dto.requestedSlots > group.maxSlots) {
        throw new ConflictException('Requested slots exceed remaining group capacity');
      }
      if (group._count.members >= group.maxMembers) {
        throw new ConflictException('Group member capacity has been reached');
      }
      if (
        dto.requestedSlots < group.minSlotsPerMember ||
        dto.requestedSlots > group.maxSlotsPerMember
      ) {
        throw new ConflictException('Requested slots violate this group’s per-member limits');
      }
      const member = await tx.ajoGroupMember.create({
        data: { groupId, userId, status: AjoMemberStatus.ACTIVE, joinedAt: new Date() },
      });
      await tx.ajoSlot.createMany({
        data: Array.from({ length: dto.requestedSlots }, (_, index) => ({
          groupId,
          memberId: member.id,
          position: group._count.slots + index + 1,
          status: AjoSlotStatus.RESERVED,
        })),
      });
      const unitMinor = group.contributionUnitMinor ?? group.baseContributionMinor;
      await tx.ajoContributionPlan.create({
        data: {
          groupId,
          memberId: member.id,
          contributionUnitMinor: unitMinor,
          unitQuantity: dto.requestedSlots,
          expectedPerCycleMinor: unitMinor * BigInt(dto.requestedSlots),
          totalExpectedMinor: 0n,
          outstandingMinor: 0n,
          expectedEntitlementMinor: unitMinor * BigInt(dto.requestedSlots),
          currency: group.currency,
        },
      });
      await tx.groupInvitation.update({
        where: { id: invitation.id },
        data: { useCount: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ajo.membership.joined',
          subjectType: 'AjoGroupMember',
          subjectId: member.id,
          groupId,
        },
      });
      return { memberId: member.id, slots: dto.requestedSlots };
    });
  }

  async lock(userId: string, groupId: string): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const membership = await tx.ajoGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (
        !membership ||
        membership.role !== AjoMemberRole.GROUP_ADMIN ||
        membership.status !== AjoMemberStatus.ACTIVE
      ) {
        throw new ForbiddenException('Only this group’s active administrator can lock it');
      }
      const group = await tx.ajoGroup.findUnique({
        where: { id: groupId },
        include: {
          slots: { orderBy: { position: 'asc' } },
          contributionPlans: { orderBy: { createdAt: 'asc' } },
          members: { where: { status: AjoMemberStatus.ACTIVE }, select: { id: true } },
        },
      });
      if (!group) throw new NotFoundException('Ajo group was not found');
      if (group.status !== AjoGroupStatus.DRAFT && group.status !== AjoGroupStatus.OPEN) {
        throw new ConflictException('Only a draft or open group can be locked');
      }
      const scheduleVersion = group.scheduleVersion + 1;
      const schedule = generateRotationSchedule({
        slots: group.slots,
        startDate: group.startDate,
        endDate: group.endDate,
        frequency: group.contributionFrequency,
        contributionAmountMinor: group.baseContributionMinor,
        contributionOpenOffsetMinutes: group.contributionOpenOffsetMinutes,
        contributionCloseOffsetMinutes: group.contributionCloseOffsetMinutes,
        gracePeriodMinutes: group.gracePeriodMinutes,
        payoutEligibilityCutoffMinutes: group.payoutEligibilityCutoffMinutes,
        payoutOffsetMinutes: group.payoutOffsetMinutes,
        payoutProcessingWindowMinutes: group.payoutProcessingWindowMinutes,
      });
      if (group.members.length > group.maxMembers) {
        throw new UnprocessableEntityException('Active member count exceeds group capacity');
      }
      if (
        group.contributionPlans.length !== group.members.length ||
        group.contributionPlans.reduce((sum, plan) => sum + plan.unitQuantity, 0) !==
          group.slots.length
      ) {
        throw new UnprocessableEntityException('Contribution plans do not match active slots');
      }
      const now = new Date();
      for (const cycle of schedule) {
        const cycleId = randomUUID();
        await tx.ajoCycle.create({
          data: {
            id: cycleId,
            groupId,
            sequence: cycle.sequence,
            status: AjoCycleStatus.PENDING,
            contributionDueAt: cycle.contributionDueAt,
            contributionOpensAt: cycle.contributionOpensAt,
            contributionClosesAt: cycle.contributionClosesAt,
            graceEndsAt: cycle.graceEndsAt,
            payoutEligibilityCutoffAt: cycle.payoutEligibilityCutoffAt,
            payoutDueAt: cycle.payoutDueAt,
            payoutProcessingEndsAt: cycle.payoutProcessingEndsAt,
          },
        });
        await tx.contributionSchedule.createMany({
          data: group.slots.map((slot) => ({
            groupId,
            cycleId,
            slotId: slot.id,
            amountDueMinor: cycle.contributionAmountMinor,
            currency: group.currency,
            dueAt: cycle.contributionDueAt,
            status: ContributionScheduleStatus.PENDING,
            scheduleVersion,
            immutableAt: now,
          })),
        });
        await tx.payoutSchedule.create({
          data: {
            groupId,
            cycleId,
            slotId: cycle.payoutSlotId,
            amountDueMinor: cycle.payoutAmountMinor,
            currency: group.currency,
            dueAt: cycle.payoutDueAt,
            status: PayoutScheduleStatus.PENDING,
            scheduleVersion,
            immutableAt: now,
          },
        });
      }
      await tx.ajoSlot.updateMany({
        where: { groupId },
        data: { status: AjoSlotStatus.ACTIVE, activatedAt: now },
      });
      for (const plan of group.contributionPlans) {
        const totalExpectedMinor = plan.expectedPerCycleMinor * BigInt(schedule.length);
        await tx.ajoContributionPlan.update({
          where: { id: plan.id },
          data: {
            totalExpectedMinor,
            outstandingMinor: totalExpectedMinor,
            expectedEntitlementMinor:
              group.baseContributionMinor * BigInt(group.slots.length) * BigInt(plan.unitQuantity),
            lockedAt: now,
          },
        });
      }
      await tx.ajoScheduleVersion.create({
        data: {
          groupId,
          version: scheduleVersion,
          reason: 'INITIAL_LOCK',
          createdByUserId: userId,
          snapshot: {
            contributionMode: group.contributionMode,
            contributionUnitMinor: (
              group.contributionUnitMinor ?? group.baseContributionMinor
            ).toString(),
            memberCount: group.members.length,
            slotCount: group.slots.length,
            cycleCount: schedule.length,
            totalExpectedInflowMinor: (
              group.baseContributionMinor *
              BigInt(group.slots.length) *
              BigInt(schedule.length)
            ).toString(),
            totalExpectedOutflowMinor: schedule
              .reduce((sum, cycle) => sum + cycle.payoutAmountMinor, 0n)
              .toString(),
          },
        },
      });
      const locked = await tx.ajoGroup.update({
        where: { id: groupId },
        data: { status: AjoGroupStatus.LOCKED, lockedAt: now, scheduleVersion },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ajo.group.locked',
          subjectType: 'AjoGroup',
          subjectId: groupId,
          groupId,
          metadata: { scheduleVersion, slotCount: group.slots.length },
        },
      });
      return { id: locked.id, status: locked.status, scheduleVersion, cycleCount: schedule.length };
    });
  }

  async schedule(userId: string, groupId: string): Promise<unknown> {
    const membership = await this.requireMembership(userId, groupId);
    const group = await this.prisma.ajoGroup.findUnique({
      where: { id: groupId },
      select: { scheduleVersion: true },
    });
    if (!group) throw new NotFoundException('Ajo group was not found');
    return this.prisma.ajoCycle.findMany({
      where: { groupId },
      select: {
        sequence: true,
        contributionDueAt: true,
        payoutDueAt: true,
        status: true,
        contributionSchedules: {
          where:
            membership.role === AjoMemberRole.GROUP_ADMIN
              ? {}
              : { slot: { memberId: membership.id } },
          select: {
            slotId: true,
            amountDueMinor: true,
            amountPaidMinor: true,
            currency: true,
            status: true,
          },
        },
        payoutSchedules: {
          where: { scheduleVersion: group.scheduleVersion },
          select: {
            slotId: true,
            amountDueMinor: true,
            amountPaidMinor: true,
            currency: true,
            status: true,
          },
        },
      },
      orderBy: { sequence: 'asc' },
    });
  }

  private async requireMembership(userId: string, groupId: string) {
    const membership = await this.prisma.ajoGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.status !== AjoMemberStatus.ACTIVE)
      throw new ForbiddenException('You do not have access to this group');
    return membership;
  }

  private digest(value: string): string {
    return digestInvitationCode(value, this.tokenPepper);
  }
}
