import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  AjoCycleStatus,
  AjoGroupStatus,
  AjoMemberRole,
  AjoMemberStatus,
  AjoSlotStatus,
  ContributionScheduleStatus,
  GroupInvitationStatus,
  PayoutScheduleStatus,
} from '../../../generated/prisma/enums.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { assertAjoGroupBounds, generateRotationSchedule } from './domain/ajo-schedule.js';
import type { CreateAjoGroupDto } from './dto/create-ajo-group.dto.js';
import type { JoinAjoGroupDto } from './dto/join-ajo-group.dto.js';

@Injectable()
export class AjoGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  async create(userId: string, dto: CreateAjoGroupDto): Promise<Record<string, unknown>> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    assertAjoGroupBounds(startDate, endDate, dto.maxSlots);
    if (dto.requestedSlots > dto.maxSlots) {
      throw new UnprocessableEntityException('Requested slots exceed group capacity');
    }
    const invitationCode = randomBytes(32).toString('base64url');
    const tokenDigest = this.digest(invitationCode);
    const created = await this.transactions.serializable(async (tx) => {
      const group = await tx.ajoGroup.create({
        data: {
          name: dto.name.trim(),
          contributionFrequency: dto.contributionFrequency,
          baseContributionMinor: BigInt(dto.baseContributionMinor),
          currency: 'NGN',
          maxSlots: dto.maxSlots,
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
        baseContributionMinor: true,
        currency: true,
        maxSlots: true,
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
        baseContributionMinor: true,
        currency: true,
        maxSlots: true,
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
      },
    });
    if (!group) throw new NotFoundException('Ajo group was not found');
    return group;
  }

  async join(userId: string, groupId: string, dto: JoinAjoGroupDto): Promise<unknown> {
    const digest = this.digest(dto.invitationCode);
    return this.transactions.serializable(async (tx) => {
      const group = await tx.ajoGroup.findUnique({
        where: { id: groupId },
        include: { _count: { select: { slots: true } } },
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
        include: { slots: { orderBy: { position: 'asc' } } },
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
      });
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
            payoutDueAt: cycle.payoutDueAt,
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
        payoutSchedule: {
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
    return createHash('sha256').update(value).digest('hex');
  }
}
