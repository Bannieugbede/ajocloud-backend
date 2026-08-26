import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AdminNotificationSeverity,
  AdminNotificationType,
  FoodCoordinatorApplicationStatus,
  KycStatus,
  StaffInviteStatus,
} from '../../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';

/** What a caller must supply to raise a notification. */
export type RaiseNotificationInput = {
  type: AdminNotificationType;
  title: string;
  body: string;
  href?: string | null;
  severity?: AdminNotificationSeverity;
  /** Addressed to one staff member; omit to broadcast. */
  userId?: string | null;
  /** Permission a reader must hold to see a broadcast. */
  permission?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
};

/** How many notifications the console feed returns in one page. */
const FEED_LIMIT = 50;

@Injectable()
export class AdminNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a notification, or refreshes the existing one for the same subject.
   *
   * Raising is idempotent on (type, subjectType, subjectId): a nightly sweep
   * that re-reports the same pending KYC profile must not stack up a new row
   * each run. A subject-less notification (an announcement, say) is always new.
   */
  async raise(input: RaiseNotificationInput): Promise<void> {
    const data = {
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      severity: input.severity ?? AdminNotificationSeverity.INFO,
      userId: input.userId ?? null,
      permission: input.permission ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
    };

    if (!input.subjectType || !input.subjectId) {
      await this.prisma.adminNotification.create({ data });
      return;
    }

    await this.prisma.adminNotification.upsert({
      where: {
        admin_notification_subject: {
          type: data.type,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
      },
      // Re-raising a still-open condition refreshes its wording but keeps the
      // original createdAt, so the feed does not reorder on every sweep.
      update: { title: data.title, body: data.body, href: data.href, resolvedAt: null },
      create: data,
    });
  }

  /**
   * Marks the notification for a subject as handled. Called when the underlying
   * work completes — a KYC decision, an inquiry closed — so the bell reflects
   * what is actually outstanding rather than everything that ever happened.
   */
  async resolveSubject(
    type: AdminNotificationType,
    subjectType: string,
    subjectId: string,
  ): Promise<void> {
    await this.prisma.adminNotification.updateMany({
      where: { type, subjectType, subjectId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  /**
   * The console feed for one staff member: everything addressed to them, plus
   * broadcasts they hold the permission for.
   */
  async list(user: {
    userId: string;
    permissions: readonly string[];
    roles: readonly string[];
  }): Promise<unknown> {
    const where = this.visibilityFilter(user);

    const [items, unreadCount] = await Promise.all([
      this.prisma.adminNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: FEED_LIMIT,
        include: { reads: { where: { userId: user.userId }, select: { readAt: true } } },
      }),
      this.prisma.adminNotification.count({
        where: { ...where, reads: { none: { userId: user.userId } } },
      }),
    ]);

    return {
      unreadCount,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        severity: item.severity,
        title: item.title,
        body: item.body,
        href: item.href,
        createdAt: item.createdAt.toISOString(),
        resolvedAt: item.resolvedAt?.toISOString() ?? null,
        readAt: item.reads[0]?.readAt.toISOString() ?? null,
      })),
    };
  }

  /** Marks one notification read for this reader. */
  async markRead(notificationId: string, userId: string): Promise<{ ok: true }> {
    const notification = await this.prisma.adminNotification.findUnique({
      where: { id: notificationId },
      select: { id: true },
    });
    if (!notification) throw new NotFoundException('That notification was not found');

    await this.prisma.adminNotificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      update: {},
      create: { notificationId, userId },
    });
    return { ok: true };
  }

  /** Marks everything currently visible to this reader as read. */
  async markAllRead(user: {
    userId: string;
    permissions: readonly string[];
    roles: readonly string[];
  }): Promise<{ ok: true; count: number }> {
    const unread = await this.prisma.adminNotification.findMany({
      where: { ...this.visibilityFilter(user), reads: { none: { userId: user.userId } } },
      select: { id: true },
      take: 500,
    });
    if (unread.length === 0) return { ok: true, count: 0 };

    await this.prisma.adminNotificationRead.createMany({
      data: unread.map((item) => ({ notificationId: item.id, userId: user.userId })),
      skipDuplicates: true,
    });
    return { ok: true, count: unread.length };
  }

  /**
   * Rebuilds the feed from the current state of the platform.
   *
   * The console has no event bus yet, so rather than depend on every write path
   * remembering to notify, this reconciles: anything still outstanding is
   * raised (idempotently), and anything since handled is resolved. Safe to run
   * on a schedule and safe to run twice.
   */
  async sync(): Promise<{ raised: number; resolved: number }> {
    let raised = 0;

    const [kyc, coordinators, inquiries, invites] = await Promise.all([
      this.prisma.kycProfile.findMany({
        where: { status: { in: [KycStatus.PENDING, KycStatus.REQUIRES_REVIEW] } },
        select: {
          id: true,
          tier: true,
          submittedAt: true,
          user: { select: { email: true, profile: true } },
        },
        take: 200,
      }),
      this.prisma.foodCoordinatorApplication.findMany({
        where: { status: FoodCoordinatorApplicationStatus.SUBMITTED },
        select: { id: true, userId: true },
        take: 200,
      }),
      this.prisma.supportInquiry.findMany({
        where: { status: 'OPEN' },
        select: { id: true, name: true, subject: true },
        take: 200,
      }),
      this.prisma.staffInvite.findMany({
        where: { status: StaffInviteStatus.PENDING },
        select: { id: true, firstName: true, lastName: true, email: true },
        take: 200,
      }),
    ]);

    for (const profile of kyc) {
      await this.raise({
        type: AdminNotificationType.KYC_REVIEW_PENDING,
        title: 'KYC awaiting review',
        body: `${describeUser(profile.user)} submitted ${profile.tier.replace('TIER_', 'Tier ')} verification.`,
        href: '/admin/kyc',
        severity: AdminNotificationSeverity.WARNING,
        permission: 'kyc.review',
        subjectType: 'KycProfile',
        subjectId: profile.id,
      });
      raised += 1;
    }

    // The application model has no user relation, so names are resolved in one
    // extra query rather than per row.
    const applicants = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: coordinators.map((row) => row.userId) } },
          select: { id: true, email: true, profile: true },
        })
      ).map((row) => [row.id, row]),
    );

    for (const application of coordinators) {
      await this.raise({
        type: AdminNotificationType.COORDINATOR_APPLICATION_PENDING,
        title: 'Coordinator application',
        body: `${describeUser(applicants.get(application.userId) ?? null)} applied to coordinate a Food Ajo programme.`,
        href: '/admin/coordinators',
        permission: 'food-coordinators.review',
        subjectType: 'FoodCoordinatorApplication',
        subjectId: application.id,
      });
      raised += 1;
    }

    for (const inquiry of inquiries) {
      await this.raise({
        type: AdminNotificationType.SUPPORT_INQUIRY_OPENED,
        title: inquiry.subject,
        body: `${inquiry.name} opened a support inquiry.`,
        href: '/admin/support',
        permission: 'disputes.manage',
        subjectType: 'SupportInquiry',
        subjectId: inquiry.id,
      });
      raised += 1;
    }

    for (const invite of invites) {
      await this.raise({
        type: AdminNotificationType.STAFF_INVITE_PENDING,
        title: 'Staff invitation pending',
        body: `${invite.firstName} ${invite.lastName} has not accepted their invite yet.`,
        href: '/admin/staff',
        permission: 'staff.manage',
        subjectType: 'StaffInvite',
        subjectId: invite.id,
      });
      raised += 1;
    }

    // Resolve anything whose subject is no longer outstanding. Each set is
    // scoped to its own type so an empty list resolves that type wholesale.
    const resolved = await this.resolveHandled({
      [AdminNotificationType.KYC_REVIEW_PENDING]: kyc.map((row) => row.id),
      [AdminNotificationType.COORDINATOR_APPLICATION_PENDING]: coordinators.map((row) => row.id),
      [AdminNotificationType.SUPPORT_INQUIRY_OPENED]: inquiries.map((row) => row.id),
      [AdminNotificationType.STAFF_INVITE_PENDING]: invites.map((row) => row.id),
    });

    return { raised, resolved };
  }

  /** Resolves open notifications whose subject is absent from the current set. */
  private async resolveHandled(
    stillOpen: Partial<Record<AdminNotificationType, string[]>>,
  ): Promise<number> {
    let resolved = 0;
    for (const [type, ids] of Object.entries(stillOpen)) {
      const result = await this.prisma.adminNotification.updateMany({
        where: {
          type: type as AdminNotificationType,
          resolvedAt: null,
          ...(ids && ids.length > 0 ? { subjectId: { notIn: ids } } : {}),
        },
        data: { resolvedAt: new Date() },
      });
      resolved += result.count;
    }
    return resolved;
  }

  /**
   * What this reader may see: their own notifications, plus broadcasts open to
   * everyone or gated on a permission they hold. Unrestricted roles see all
   * broadcasts, matching PermissionsGuard.
   */
  private visibilityFilter(user: {
    userId: string;
    permissions: readonly string[];
    roles: readonly string[];
  }) {
    const unrestricted = user.roles.some(
      (role) => role === 'SUPER_ADMIN' || role === 'PLATFORM_ADMIN',
    );
    return {
      resolvedAt: null,
      OR: [
        { userId: user.userId },
        unrestricted
          ? { userId: null }
          : {
              userId: null,
              OR: [{ permission: null }, { permission: { in: [...user.permissions] } }],
            },
      ],
    };
  }
}

function describeUser(
  user: { email: string | null; profile: { firstName: string; lastName: string } | null } | null,
): string {
  if (user?.profile) return `${user.profile.firstName} ${user.profile.lastName}`;
  return user?.email ?? 'A user';
}
