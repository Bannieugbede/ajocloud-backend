import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AjoGroupStatus,
  AjoMemberStatus,
  GroupInvitationStatus,
} from '../../../generated/prisma/enums.js';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import type { CreateGroupInvitationDto } from './dto/create-group-invitation.dto.js';
import { digestInvitationCode, generateInvitationCode } from './domain/invitation-code.js';
import {
  INVITATION_TTL_MS,
  MAX_LIVE_INVITATIONS_PER_MEMBER,
  effectiveInvitationStatus,
  remainingUses,
} from './domain/group-invitation-policy.js';

/** An invitation as its issuer sees it. The raw token is never included. */
export interface GroupInvitationSummary {
  readonly id: string;
  readonly status: GroupInvitationStatus;
  readonly maxUses: number;
  readonly useCount: number;
  readonly remainingUses: number;
  readonly expiresAt: string;
  readonly createdAt: string;
}

/** An invitation as it is returned once, at creation, with its shareable link. */
export interface IssuedGroupInvitation extends GroupInvitationSummary {
  /** Shown once. Only the digest is stored, so this cannot be recovered later. */
  readonly code: string;
  readonly url: string;
}

/**
 * What the public landing page may show about a group before anyone signs in.
 *
 * Deliberately thin. Whoever holds the link may be a stranger who was forwarded
 * it, so this carries what someone needs to decide whether to accept — who
 * invited them, what the group is, what it costs — and nothing that would let
 * them profile the membership. No member list, no balances, no group id.
 */
export interface PublicInvitationPreview {
  readonly groupName: string;
  readonly inviterName: string;
  readonly contributionAmountMinor: string;
  readonly currency: string;
  readonly contributionFrequency: string;
  readonly memberCount: number;
  readonly maxMembers: number;
  readonly expiresAt: string;
}

@Injectable()
export class GroupInvitationsService {
  private readonly tokenPepper: string;
  private readonly webUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    config: ConfigService<Environment, true>,
  ) {
    this.tokenPepper = config.get('TOKEN_PEPPER', { infer: true });
    this.webUrl = config.get('ADMIN_WEB_URL', { infer: true }).replace(/\/+$/, '');
  }

  /**
   * Issues an invitation link for a group the caller is an active member of.
   *
   * The raw code is returned exactly once, here. What is stored is its HMAC, so
   * an invitation cannot be redeemed by anyone who can read the database.
   */
  async create(
    userId: string,
    groupId: string,
    dto: CreateGroupInvitationDto,
  ): Promise<IssuedGroupInvitation> {
    const code = generateInvitationCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

    const invitation = await this.transactions.serializable(async (tx) => {
      const member = await tx.ajoGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { id: true, status: true },
      });
      if (!member || member.status !== AjoMemberStatus.ACTIVE) {
        throw new ForbiddenException('Only an active member of this group can invite others');
      }

      const group = await tx.ajoGroup.findUnique({
        where: { id: groupId },
        select: { status: true },
      });
      if (!group) throw new NotFoundException('Ajo group was not found');
      // Matches what join accepts. Inviting into a group that has locked its
      // rotation would produce a link that cannot be redeemed.
      if (group.status !== AjoGroupStatus.DRAFT && group.status !== AjoGroupStatus.OPEN) {
        throw new ConflictException('This group no longer accepts members');
      }

      const live = await tx.groupInvitation.count({
        where: {
          createdByMemberId: member.id,
          status: GroupInvitationStatus.ACTIVE,
          expiresAt: { gt: now },
        },
      });
      if (live >= MAX_LIVE_INVITATIONS_PER_MEMBER) {
        throw new ConflictException(
          'You have too many open invitations for this group. Revoke one before creating another.',
        );
      }

      return tx.groupInvitation.create({
        data: {
          groupId,
          createdByMemberId: member.id,
          tokenDigest: this.digest(code),
          maxUses: dto.maxUses,
          expiresAt,
        },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'ajo.invitation.created',
        subjectType: 'GroupInvitation',
        subjectId: invitation.id,
        groupId,
        metadata: { maxUses: invitation.maxUses },
      },
    });

    return {
      ...this.summarise(invitation, now),
      code,
      url: `${this.webUrl}/join/${code}`,
    };
  }

  /** The caller's own live and spent invitations for a group. */
  async list(userId: string, groupId: string): Promise<{ items: GroupInvitationSummary[] }> {
    const member = await this.prisma.ajoGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { id: true, status: true },
    });
    if (!member || member.status !== AjoMemberStatus.ACTIVE) {
      throw new ForbiddenException('Only an active member of this group can see its invitations');
    }

    const invitations = await this.prisma.groupInvitation.findMany({
      where: { groupId, createdByMemberId: member.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const now = new Date();
    return { items: invitations.map((invitation) => this.summarise(invitation, now)) };
  }

  /** Revokes an invitation the caller issued, so its link stops working. */
  async revoke(userId: string, groupId: string, invitationId: string): Promise<void> {
    await this.transactions.serializable(async (tx) => {
      const member = await tx.ajoGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { id: true, status: true },
      });
      if (!member || member.status !== AjoMemberStatus.ACTIVE) {
        throw new ForbiddenException('Only an active member of this group can revoke invitations');
      }

      const invitation = await tx.groupInvitation.findUnique({ where: { id: invitationId } });
      // An invitation belonging to another group or another issuer is reported
      // as missing rather than forbidden, so ids cannot be probed for existence.
      if (
        !invitation ||
        invitation.groupId !== groupId ||
        invitation.createdByMemberId !== member.id
      ) {
        throw new NotFoundException('That invitation was not found');
      }
      if (invitation.status !== GroupInvitationStatus.ACTIVE) return;

      await tx.groupInvitation.update({
        where: { id: invitationId },
        data: { status: GroupInvitationStatus.REVOKED, revokedAt: new Date() },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'ajo.invitation.revoked',
        subjectType: 'GroupInvitation',
        subjectId: invitationId,
        groupId,
      },
    });
  }

  /**
   * Describes an invitation to the public landing page.
   *
   * Unauthenticated by necessity: the whole point is that the recipient may not
   * have an account, or even the app, yet. Every unusable invitation — missing,
   * revoked, expired, spent — is reported identically, so a guessed code cannot
   * be used to learn that a group exists.
   */
  async preview(code: string): Promise<PublicInvitationPreview> {
    const invitation = await this.prisma.groupInvitation.findUnique({
      where: { tokenDigest: this.digest(code) },
      include: {
        group: {
          select: {
            name: true,
            status: true,
            currency: true,
            maxMembers: true,
            baseContributionMinor: true,
            contributionUnitMinor: true,
            contributionFrequency: true,
            _count: { select: { members: { where: { status: AjoMemberStatus.ACTIVE } } } },
          },
        },
        createdBy: { select: { userId: true } },
      },
    });

    const now = new Date();
    if (
      !invitation ||
      effectiveInvitationStatus({ ...invitation, now }) !== GroupInvitationStatus.ACTIVE ||
      (invitation.group.status !== AjoGroupStatus.DRAFT &&
        invitation.group.status !== AjoGroupStatus.OPEN)
    ) {
      throw new NotFoundException('This invitation is no longer valid');
    }

    // AjoGroupMember carries no user relation, so the inviter's name is read
    // separately, as elsewhere in this module.
    const inviter = await this.prisma.userProfile.findUnique({
      where: { userId: invitation.createdBy.userId },
      select: { firstName: true, lastName: true },
    });

    const group = invitation.group;
    return {
      groupName: group.name,
      // A first name and an initial is enough to recognise someone you know
      // without handing a stranger a full name from a forwarded link.
      inviterName: inviter
        ? `${inviter.firstName} ${inviter.lastName.slice(0, 1)}.`.trim()
        : 'A member',
      contributionAmountMinor: (
        group.contributionUnitMinor ?? group.baseContributionMinor
      ).toString(),
      currency: group.currency,
      contributionFrequency: group.contributionFrequency,
      memberCount: group._count.members,
      maxMembers: group.maxMembers,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Resolves an invitation code to the group it admits, for a signed-in caller.
   *
   * A link carries only the code — deliberately, since the public preview must
   * not hand a group id to whoever holds a forwarded message. Once someone has
   * an account, the app still needs that id to join, and asking them to type it
   * from the invitation is exactly the friction the link exists to remove.
   */
  async resolveGroup(code: string): Promise<{ groupId: string; groupName: string }> {
    const invitation = await this.prisma.groupInvitation.findUnique({
      where: { tokenDigest: this.digest(code) },
      include: { group: { select: { id: true, name: true, status: true } } },
    });

    const now = new Date();
    if (
      !invitation ||
      effectiveInvitationStatus({ ...invitation, now }) !== GroupInvitationStatus.ACTIVE ||
      (invitation.group.status !== AjoGroupStatus.DRAFT &&
        invitation.group.status !== AjoGroupStatus.OPEN)
    ) {
      throw new NotFoundException('This invitation is no longer valid');
    }

    return { groupId: invitation.group.id, groupName: invitation.group.name };
  }

  private summarise(
    invitation: {
      id: string;
      status: GroupInvitationStatus;
      maxUses: number;
      useCount: number;
      expiresAt: Date;
      createdAt: Date;
    },
    now: Date,
  ): GroupInvitationSummary {
    return {
      id: invitation.id,
      status: effectiveInvitationStatus({ ...invitation, now }),
      maxUses: invitation.maxUses,
      useCount: invitation.useCount,
      remainingUses: remainingUses({ ...invitation, now }),
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  private digest(code: string): string {
    return digestInvitationCode(code, this.tokenPepper);
  }
}
