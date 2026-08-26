import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, argon2id } from 'argon2';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { StaffInviteStatus, UserStatus } from '../../../../generated/prisma/enums.js';
import type { Environment } from '../../../config/env.schema.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../../infrastructure/database/transaction.service.js';
import { TransactionalNotificationService } from '../../notifications/transactional-notification.service.js';
import type { InviteStaffDto } from '../dto/staff-invite.dto.js';
import { humaniseRole } from './staff-roles.js';

/** Invites are long-lived compared to a sign-in code, but not indefinite. */
export const INVITE_TTL_HOURS = 72;
const INVITE_TTL_MS = INVITE_TTL_HOURS * 60 * 60 * 1_000;

export interface StaffInviteSummary {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: string;
  readonly status: StaffInviteStatus;
  readonly invitedBy: string | null;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly createdAt: string;
  /**
   * Whether the invitation email actually went out. The invite is valid either
   * way — the link works once delivered — but the console must not claim it was
   * sent when the provider rejected it, or nobody would think to resend.
   */
  readonly deliveryStatus?: 'SENT' | 'FAILED';
}

/** What the accept page needs to render before anyone types a password. */
export interface StaffInvitePreview {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: string;
  readonly expiresAt: string;
}

@Injectable()
export class StaffInviteService {
  private readonly tokenPepper: string;
  private readonly adminWebUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly notifications: TransactionalNotificationService,
    config: ConfigService<Environment, true>,
  ) {
    this.tokenPepper = config.get('TOKEN_PEPPER', { infer: true });
    // The invite page lives at the site root, not under /admin. Tolerate a
    // value that points at the console anyway: a stray "/admin" here produces
    // a 404 link in an email that cannot be re-sent without revoking first.
    this.adminWebUrl = config
      .get('ADMIN_WEB_URL', { infer: true })
      .replace(/\/+$/, '')
      .replace(/\/admin$/, '');
  }

  /**
   * Creates an invitation and emails the link.
   *
   * The raw token exists only in this method and in the email: what is stored
   * is its digest, so the invite cannot be accepted by reading the database.
   */
  async invite(dto: InviteStaffDto, invitedById: string): Promise<StaffInviteSummary> {
    const email = dto.email.trim().toLowerCase();

    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role) throw new BadRequestException('That role does not exist');

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException('Someone with that email address already has an account');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await this.transactions.serializable(async (tx) => {
      // Supersede any outstanding invite so the newest link is the only live
      // one; the partial unique index would otherwise reject this insert.
      await tx.staffInvite.updateMany({
        where: { email, status: StaffInviteStatus.PENDING },
        data: { status: StaffInviteStatus.REVOKED, revokedAt: new Date() },
      });
      return tx.staffInvite.create({
        data: {
          email,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          roleId: role.id,
          tokenHash: this.digest(token),
          invitedById,
          expiresAt,
        },
        include: { role: { select: { name: true } } },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: invitedById,
        action: 'admin.staff.invited',
        subjectType: 'StaffInvite',
        subjectId: invite.id,
        metadata: { email, role: role.name },
      },
    });

    const inviter = await this.prisma.userProfile.findUnique({
      where: { userId: invitedById },
      select: { firstName: true, lastName: true },
    });

    const delivery = await this.notifications.sendEmail({
      // The invitee has no account yet, so the notification is attributed to
      // the staff member who sent it.
      userId: invitedById,
      destination: email,
      template: 'staff-invite',
      variables: {
        inviterName: inviter ? `${inviter.firstName} ${inviter.lastName}` : 'An administrator',
        roleName: humaniseRole(role.name),
        // Deliberately outside /admin: that layout redirects anyone without a
        // session to sign-in, which is every invitee until they accept.
        inviteUrl: `${this.adminWebUrl}/invite?token=${token}`,
        expiresHours: String(INVITE_TTL_HOURS),
      },
      storedPayload: { inviteId: invite.id },
      dedupeKey: `staff-invite:${invite.id}`,
    });

    return { ...this.summarise(invite, inviter), deliveryStatus: delivery.status };
  }

  async list(): Promise<{ items: StaffInviteSummary[] }> {
    const invites = await this.prisma.staffInvite.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        role: { select: { name: true } },
        invitedBy: { select: { profile: { select: { firstName: true, lastName: true } } } },
      },
    });
    // An invite past its expiry is reported as EXPIRED even before the row is
    // rewritten, so the list never shows a link that would no longer work.
    return {
      items: invites.map((invite) => ({
        ...this.summarise(invite, invite.invitedBy.profile),
        status: this.effectiveStatus(invite),
      })),
    };
  }

  async revoke(inviteId: string, actorUserId: string): Promise<StaffInviteSummary> {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { id: inviteId },
      include: { role: { select: { name: true } } },
    });
    if (!invite) throw new NotFoundException('That invitation was not found');
    if (invite.status === StaffInviteStatus.ACCEPTED) {
      throw new ConflictException('That invitation has already been accepted');
    }
    if (invite.status === StaffInviteStatus.REVOKED) return this.summarise(invite, null);

    const revoked = await this.prisma.staffInvite.update({
      where: { id: inviteId },
      data: { status: StaffInviteStatus.REVOKED, revokedAt: new Date() },
      include: { role: { select: { name: true } } },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'admin.staff.invite_revoked',
        subjectType: 'StaffInvite',
        subjectId: inviteId,
        metadata: { email: invite.email },
      },
    });
    return this.summarise(revoked, null);
  }

  /**
   * Describes an invitation to the unauthenticated accept page. Anything other
   * than a live invite is reported the same way, so a guessed token cannot be
   * used to tell a revoked invite from one that never existed.
   */
  async preview(token: string): Promise<StaffInvitePreview> {
    const invite = await this.findLiveInvite(token);
    return {
      email: invite.email,
      firstName: invite.firstName,
      lastName: invite.lastName,
      role: humaniseRole(invite.role.name),
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  /**
   * Redeems the invitation, creating the staff account with its password and
   * role in one transaction. Returns the new user id so the caller can start a
   * session without a second sign-in step.
   */
  async accept(token: string, password: string): Promise<{ userId: string }> {
    const invite = await this.findLiveInvite(token);
    const passwordHash = await hash(password, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });

    const outcome = await this.transactions.serializable(async (tx) => {
      // Re-read inside the transaction: two tabs opening the same link must not
      // both create an account.
      const current = await tx.staffInvite.findUnique({ where: { id: invite.id } });
      if (!current || current.status !== StaffInviteStatus.PENDING) return 'consumed' as const;
      if (current.expiresAt <= new Date()) return 'expired' as const;
      if (await tx.user.findUnique({ where: { email: current.email } })) {
        return 'taken' as const;
      }

      const user = await tx.user.create({
        data: {
          email: current.email,
          // The invitation was delivered to this mailbox and redeemed from it,
          // which is the same proof the email-verification flow asks for.
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          credential: { create: { passwordHash } },
          profile: { create: { firstName: current.firstName, lastName: current.lastName } },
          roleAssignments: { create: { roleId: current.roleId, grantedById: current.invitedById } },
        },
      });
      await tx.staffInvite.update({
        where: { id: current.id },
        data: {
          status: StaffInviteStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedUserId: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'admin.staff.invite_accepted',
          subjectType: 'StaffInvite',
          subjectId: current.id,
          metadata: { email: current.email },
        },
      });
      return { kind: 'ok' as const, userId: user.id };
    });

    if (outcome === 'expired') {
      throw new BadRequestException('This invitation has expired. Ask for a new one.');
    }
    if (outcome === 'taken') {
      throw new ConflictException('An account already exists for this email address');
    }
    if (outcome === 'consumed') {
      throw new ForbiddenException('This invitation is no longer valid');
    }
    return { userId: outcome.userId };
  }

  /**
   * Looks up a pending, unexpired invite by its raw token. Every failure raises
   * the same error: the accept page must not distinguish "wrong token" from
   * "already used".
   */
  private async findLiveInvite(token: string) {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: this.digest(token) },
      include: { role: { select: { name: true } } },
    });
    if (
      !invite ||
      invite.status !== StaffInviteStatus.PENDING ||
      invite.expiresAt <= new Date() ||
      // Constant-time comparison of the digest, so a near-miss token cannot be
      // distinguished by how long the lookup took.
      !safeEqual(invite.tokenHash, this.digest(token))
    ) {
      throw new ForbiddenException('This invitation link is invalid or has expired');
    }
    return invite;
  }

  private effectiveStatus(invite: {
    status: StaffInviteStatus;
    expiresAt: Date;
  }): StaffInviteStatus {
    if (invite.status === StaffInviteStatus.PENDING && invite.expiresAt <= new Date()) {
      return StaffInviteStatus.EXPIRED;
    }
    return invite.status;
  }

  private summarise(
    invite: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      status: StaffInviteStatus;
      expiresAt: Date;
      acceptedAt: Date | null;
      createdAt: Date;
      role: { name: string };
    },
    inviter: { firstName: string; lastName: string } | null,
  ): StaffInviteSummary {
    return {
      id: invite.id,
      email: invite.email,
      firstName: invite.firstName,
      lastName: invite.lastName,
      role: invite.role.name,
      status: this.effectiveStatus(invite),
      invitedBy: inviter ? `${inviter.firstName} ${inviter.lastName}` : null,
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt?.toISOString() ?? null,
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private digest(token: string): string {
    return createHmac('sha256', this.tokenPepper).update(token).digest('hex');
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
