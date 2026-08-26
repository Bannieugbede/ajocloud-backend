import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AjoCycleStatus,
  AjoGroupStatus,
  BillPaymentStatus,
  FeeAssessmentStatus,
  KycStatus,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  UserStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AdminListQueryDto } from './dto/admin-query.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

const ACTIVE_GROUP_STATUSES = [AjoGroupStatus.LOCKED, AjoGroupStatus.ACTIVE, AjoGroupStatus.OPEN];

type UserSummary = {
  id: string;
  email: string | null;
  profile: { firstName: string; lastName: string } | null;
};

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<unknown> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalUsers, activeGroups, usersLast30d, volumeRows, fees, recentTransactions] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.ajoGroup.count({ where: { status: { in: ACTIVE_GROUP_STATUSES } } }),
        this.prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
        this.prisma.ledgerEntry.aggregate({
          where: {
            direction: LedgerEntryDirection.CREDIT,
            transaction: {
              status: LedgerTransactionStatus.POSTED,
              postedAt: { gte: thirtyDaysAgo },
            },
          },
          _sum: { amountMinor: true },
        }),
        this.prisma.feeAssessment.aggregate({
          where: { status: FeeAssessmentStatus.PAID, createdAt: { gte: thirtyDaysAgo } },
          _sum: { amountMinor: true },
        }),
        this.prisma.ledgerTransaction.findMany({
          where: { status: LedgerTransactionStatus.POSTED },
          orderBy: { postedAt: 'desc' },
          take: 8,
          select: {
            id: true,
            reference: true,
            description: true,
            currency: true,
            status: true,
            postedAt: true,
            initiatedByUserId: true,
            entries: {
              select: {
                direction: true,
                amountMinor: true,
                account: { select: { walletId: true } },
              },
            },
          },
        }),
      ]);

    return {
      kpis: {
        totalUsers,
        activeGroups,
        usersLast30d,
        volume30dMinor: (volumeRows._sum.amountMinor ?? 0n).toString(),
        fees30dMinor: (fees._sum.amountMinor ?? 0n).toString(),
      },
      recentTransactions: recentTransactions.map((transaction) => ({
        id: transaction.id,
        reference: transaction.reference,
        description: transaction.description,
        currency: transaction.currency,
        status: transaction.status,
        postedAt: transaction.postedAt,
        amountMinor: transaction.entries.reduce(
          (sum, entry) =>
            entry.direction === LedgerEntryDirection.CREDIT ? sum + entry.amountMinor : sum,
          0n,
        ),
        walletId:
          transaction.entries.find((entry) => entry.account.walletId)?.account.walletId ?? null,
      })),
    };
  }

  /**
   * The signed-in administrator, for the console topbar and access checks.
   */
  async currentUser(userId: string, permissions: readonly string[]): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        profile: { select: { firstName: true, lastName: true, avatarUrl: true } },
        roleAssignments: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User was not found');
    return {
      ...user,
      roles: user.roleAssignments.map((assignment) => assignment.role.name),
      permissions,
    };
  }

  /** The signed-in staff member's own profile, for the profile page. */
  async profile(userId: string): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        createdAt: true,
        lastLoginAt: true,
        profile: true,
        roleAssignments: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User was not found');
    const { roleAssignments, ...rest } = user;
    return { ...rest, roles: roleAssignments.map((assignment) => assignment.role.name) };
  }

  /**
   * Updates the signed-in staff member's own profile. Only the fields the DTO
   * allows are written, and a profile row is created if the account somehow
   * lacks one, so the page never fails on an incomplete account.
   */
  async updateProfile(userId: string, input: UpdateProfileDto): Promise<unknown> {
    const { phone, ...profileFields } = input;

    // Undefined means "not submitted"; only write what was actually sent.
    const data = Object.fromEntries(
      Object.entries(profileFields).filter(([, value]) => value !== undefined),
    );

    if (phone !== undefined) {
      const clash = await this.prisma.user.findFirst({
        where: { phone, NOT: { id: userId } },
        select: { id: true },
      });
      if (clash) throw new ConflictException('That phone number is already in use.');
    }

    await this.prisma.$transaction(async (tx) => {
      if (phone !== undefined) {
        // A changed number is unverified until it is confirmed again.
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { phone: true },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            phone,
            ...(current?.phone !== phone ? { phoneVerifiedAt: null } : {}),
          },
        });
      }
      if (Object.keys(data).length > 0) {
        await tx.userProfile.upsert({
          where: { userId },
          update: data,
          create: {
            userId,
            firstName: data.firstName ?? '',
            lastName: data.lastName ?? '',
            ...data,
          },
        });
      }
    });

    return this.profile(userId);
  }

  /**
   * Posted credit volume bucketed into equal windows ending today, for the
   * dashboard volume chart. `weeks` covers the trailing period.
   */
  async volumeSeries(weeks = 10): Promise<unknown> {
    const bucketMs = 7 * 24 * 60 * 60 * 1_000;
    const now = new Date();
    const start = new Date(now.getTime() - weeks * bucketMs);

    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        direction: LedgerEntryDirection.CREDIT,
        transaction: {
          status: LedgerTransactionStatus.POSTED,
          postedAt: { gte: start },
        },
      },
      select: { amountMinor: true, transaction: { select: { postedAt: true } } },
    });

    const buckets = Array.from({ length: weeks }, (_, index) => ({
      startsAt: new Date(start.getTime() + index * bucketMs),
      totalMinor: 0n,
    }));
    for (const entry of entries) {
      const postedAt = entry.transaction.postedAt;
      if (!postedAt) continue;
      const index = Math.min(
        buckets.length - 1,
        Math.floor((postedAt.getTime() - start.getTime()) / bucketMs),
      );
      if (index < 0) continue;
      buckets[index]!.totalMinor += entry.amountMinor;
    }

    const total = buckets.reduce((sum, bucket) => sum + bucket.totalMinor, 0n);
    const half = Math.floor(buckets.length / 2);
    const previous = buckets.slice(0, half).reduce((sum, b) => sum + b.totalMinor, 0n);
    const recent = buckets.slice(half).reduce((sum, b) => sum + b.totalMinor, 0n);

    return {
      currency: 'NGN',
      totalMinor: total.toString(),
      // Percentage change of the most recent half against the one before it.
      changePercent:
        previous === 0n ? null : Number(((recent - previous) * 10_000n) / previous) / 100,
      buckets: buckets.map((bucket) => ({
        startsAt: bucket.startsAt.toISOString(),
        totalMinor: bucket.totalMinor.toString(),
      })),
    };
  }

  /**
   * Active groups with cycle progress, for the dashboard side panel.
   */
  async activeGroups(limit = 5): Promise<unknown> {
    const groups = await this.prisma.ajoGroup.findMany({
      where: { status: { in: ACTIVE_GROUP_STATUSES }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        status: true,
        currency: true,
        baseContributionMinor: true,
        numberOfCycles: true,
        _count: { select: { members: true, cycles: true } },
        cycles: {
          orderBy: { sequence: 'asc' },
          select: { sequence: true, status: true },
        },
      },
    });

    return {
      items: groups.map((group) => {
        const completed = group.cycles.filter(
          (cycle) => cycle.status === AjoCycleStatus.COMPLETED,
        ).length;
        const totalCycles = group.numberOfCycles || group._count.cycles || 0;
        const inProgress = group.cycles.find(
          (cycle) =>
            cycle.status === AjoCycleStatus.OPEN || cycle.status === AjoCycleStatus.PROCESSING,
        );
        const currentCycle = inProgress?.sequence ?? Math.min(completed + 1, totalCycles || 1);
        return {
          id: group.id,
          name: group.name,
          status: group.status,
          currency: group.currency,
          members: group._count.members,
          // Pot for one full cycle: every member contributes the base amount.
          potMinor: (group.baseContributionMinor * BigInt(group._count.members)).toString(),
          currentCycle,
          totalCycles,
          progressPercent: totalCycles > 0 ? Math.round((completed / totalCycles) * 100) : 0,
        };
      }),
    };
  }

  async listUsers(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: this.parseUserStatus(query.status) } : {};
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        profile: { select: { firstName: true, lastName: true, avatarUrl: true } },
        kycProfile: { select: { status: true, tier: true, level: true } },
        roleAssignments: { select: { role: { select: { name: true } } } },
        _count: { select: { wallets: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return this.paginate(users, limit);
  }

  async getUser(userId: string): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        lastLoginAt: true,
        suspendedAt: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
        kycProfile: {
          select: {
            id: true,
            status: true,
            tier: true,
            level: true,
            verifiedAt: true,
            checks: {
              select: { type: true, status: true, provider: true, maskedIdentifier: true },
            },
          },
        },
        roleAssignments: {
          select: { role: { select: { name: true, description: true } } },
        },
        wallets: {
          select: { id: true, currency: true, status: true, createdAt: true },
        },
      },
    });
    if (!user) throw new NotFoundException('User was not found');
    return user;
  }

  async listAjoGroups(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status
      ? { status: this.parseAjoStatus(query.status) }
      : { deletedAt: null };
    const groups = await this.prisma.ajoGroup.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        contributionMode: true,
        contributionFrequency: true,
        baseContributionMinor: true,
        currency: true,
        maxSlots: true,
        maxMembers: true,
        startDate: true,
        endDate: true,
        lockedAt: true,
        createdAt: true,
        _count: { select: { slots: true, members: true, cycles: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return this.paginate(groups, limit);
  }

  async getAjoGroup(groupId: string): Promise<unknown> {
    const group = await this.prisma.ajoGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        contributionMode: true,
        contributionFrequency: true,
        baseContributionMinor: true,
        contributionUnitMinor: true,
        currency: true,
        maxSlots: true,
        maxMembers: true,
        minSlotsPerMember: true,
        maxSlotsPerMember: true,
        numberOfCycles: true,
        businessTimezone: true,
        startDate: true,
        endDate: true,
        lockedAt: true,
        activatedAt: true,
        scheduleVersion: true,
        createdAt: true,
        members: {
          select: { id: true, userId: true, role: true, status: true, joinedAt: true },
        },
        cycles: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            sequence: true,
            status: true,
            contributionDueAt: true,
            payoutDueAt: true,
          },
        },
        _count: { select: { contributions: true, payouts: true, swapRequests: true, slots: true } },
      },
    });
    if (!group) throw new NotFoundException('Ajo group was not found');
    const membersWithUsers = await this.attachUsers(
      group.members.map((member) => ({ ...member })),
      (member) => member.userId,
    );
    return { ...group, members: membersWithUsers };
  }

  async listAkawoGoals(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: this.parseGoalStatus(query.status) } : {};
    const goals = await this.prisma.savingsGoal.findMany({
      where,
      select: {
        id: true,
        userId: true,
        name: true,
        type: true,
        targetMinor: true,
        currency: true,
        status: true,
        targetDate: true,
        autoSaveEnabled: true,
        createdAt: true,
        _count: { select: { contributions: true, schedules: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const enriched = await this.attachUsers(goals, (goal) => goal.userId);
    return this.paginate(enriched, limit);
  }

  async listFoodAjo(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: this.parseFoodStatus(query.status) } : {};
    const programmes = await this.prisma.foodAjoGroup.findMany({
      where,
      select: {
        id: true,
        coordinatorUserId: true,
        name: true,
        status: true,
        currency: true,
        contributionMinor: true,
        contributionFrequency: true,
        enrolmentCapacity: true,
        fulfilmentMethod: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        packages: { select: { id: true, name: true, priceMinor: true, isActive: true } },
        _count: { select: { subscriptions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const enriched = await this.attachUsers(programmes, (programme) => programme.coordinatorUserId);
    return this.paginate(enriched, limit);
  }

  async listBillPayments(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: this.parseBillStatus(query.status) } : {};
    const payments = await this.prisma.billPayment.findMany({
      where,
      select: {
        id: true,
        userId: true,
        internalReference: true,
        provider: true,
        status: true,
        amountMinor: true,
        feeMinor: true,
        totalDebitMinor: true,
        currency: true,
        customerReferenceMasked: true,
        verifiedCustomerName: true,
        createdAt: true,
        completedAt: true,
        biller: { select: { name: true } },
        product: { select: { name: true } },
        receipt: { select: { receiptNumber: true, issuedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const enriched = await this.attachUsers(payments, (payment) => payment.userId);
    return this.paginate(enriched, limit);
  }

  async listLedger(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: this.parseLedgerStatus(query.status) } : {};
    const transactions = await this.prisma.ledgerTransaction.findMany({
      where,
      select: {
        id: true,
        reference: true,
        description: true,
        currency: true,
        status: true,
        postedAt: true,
        createdAt: true,
        entries: {
          select: {
            direction: true,
            amountMinor: true,
            account: { select: { code: true, name: true, walletId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return this.paginate(transactions, limit);
  }

  async listKyc(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: this.parseKycStatus(query.status) } : {};
    const profiles = await this.prisma.kycProfile.findMany({
      where,
      select: {
        id: true,
        userId: true,
        status: true,
        tier: true,
        level: true,
        submittedAt: true,
        verifiedAt: true,
        createdAt: true,
        _count: { select: { checks: true, documents: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const enriched = await this.attachUsers(profiles, (profile) => profile.userId);
    return this.paginate(enriched, limit);
  }

  async listCoordinators(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: this.parseCoordinatorStatus(query.status) } : {};
    const applications = await this.prisma.foodCoordinatorApplication.findMany({
      where,
      select: {
        id: true,
        userId: true,
        status: true,
        submittedAt: true,
        approvedAt: true,
        expiresAt: true,
        rejectionReason: true,
        createdAt: true,
        _count: { select: { documents: true, reviews: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const enriched = await this.attachUsers(applications, (application) => application.userId);
    return this.paginate(enriched, limit);
  }

  async listWaitlist(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: query.status } : {};
    const entries = await this.prisma.waitlistEntry.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        wantsPromotions: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return this.paginate(entries, limit);
  }

  async listSupportInquiries(query: AdminListQueryDto): Promise<unknown> {
    const limit = query.limit;
    const where = query.status ? { status: query.status } : {};
    const inquiries = await this.prisma.supportInquiry.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        subject: true,
        message: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return this.paginate(inquiries, limit);
  }

  async listFees(): Promise<unknown> {
    return this.prisma.feeDefinition.findMany({
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        code: true,
        version: true,
        name: true,
        calculationType: true,
        amountMinor: true,
        basisPoints: true,
        currency: true,
        minimumMinor: true,
        maximumMinor: true,
        payerType: true,
        chargeEvent: true,
        refundable: true,
        effectiveAt: true,
        expiresAt: true,
        isActive: true,
      },
    });
  }

  async getSettings(): Promise<unknown> {
    const [brand, roles, feeCount] = await Promise.all([
      this.prisma.publicAppConfiguration.findFirst({
        where: { key: 'brand', isActive: true },
        orderBy: { version: 'desc' },
        select: { value: true, effectiveAt: true, updatedAt: true },
      }),
      this.prisma.role.findMany({
        select: {
          name: true,
          description: true,
          isSystem: true,
          _count: { select: { users: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.feeDefinition.count(),
    ]);
    return { brand: brand?.value ?? null, roles, feeCount };
  }

  private async attachUsers<T>(
    items: T[],
    getUserId: (item: T) => string,
  ): Promise<Array<T & { user: UserSummary | null }>> {
    const ids = [...new Set(items.map((item) => getUserId(item)))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));
    return items.map((item) => ({ ...item, user: userMap.get(getUserId(item)) ?? null }));
  }

  private paginate<T>(items: T[], limit: number): { items: T[]; nextCursor: string | null } {
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    return { items: page, nextCursor: hasMore ? this.lastId(page) : null };
  }

  private lastId<T>(items: T[]): string | null {
    const last = items.at(-1) as { id?: string } | undefined;
    return last?.id ?? null;
  }

  private parseUserStatus(value: string): UserStatus {
    if (Object.values(UserStatus).includes(value as UserStatus)) return value as UserStatus;
    throw new NotFoundException(`Unknown user status: ${value}`);
  }

  private parseAjoStatus(value: string): AjoGroupStatus {
    if (Object.values(AjoGroupStatus).includes(value as AjoGroupStatus))
      return value as AjoGroupStatus;
    throw new NotFoundException(`Unknown Ajo group status: ${value}`);
  }

  private parseGoalStatus(
    value: string,
  ): 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' {
    const valid = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
    const match = valid.find((candidate) => candidate === value);
    if (!match) throw new NotFoundException(`Unknown savings goal status: ${value}`);
    return match;
  }

  private parseFoodStatus(
    value: string,
  ): 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED' | 'SUSPENDED' | 'CANCELLED' {
    const valid = ['DRAFT', 'OPEN', 'ACTIVE', 'COMPLETED', 'SUSPENDED', 'CANCELLED'];
    if (valid.includes(value)) return value as 'OPEN';
    throw new NotFoundException(`Unknown Food Ajo status: ${value}`);
  }

  private parseBillStatus(value: string): BillPaymentStatus {
    if (Object.values(BillPaymentStatus).includes(value as BillPaymentStatus))
      return value as BillPaymentStatus;
    throw new NotFoundException(`Unknown bill payment status: ${value}`);
  }

  private parseLedgerStatus(value: string): LedgerTransactionStatus {
    if (Object.values(LedgerTransactionStatus).includes(value as LedgerTransactionStatus))
      return value as LedgerTransactionStatus;
    throw new NotFoundException(`Unknown ledger status: ${value}`);
  }

  private parseKycStatus(value: string): KycStatus {
    if (Object.values(KycStatus).includes(value as KycStatus)) return value as KycStatus;
    throw new NotFoundException(`Unknown KYC status: ${value}`);
  }

  private parseCoordinatorStatus(
    value: string,
  ):
    | 'DRAFT'
    | 'SUBMITTED'
    | 'AUTOMATED_REVIEW'
    | 'MANUAL_REVIEW'
    | 'MORE_INFORMATION_REQUIRED'
    | 'APPROVED'
    | 'REJECTED'
    | 'SUSPENDED'
    | 'REVOKED'
    | 'EXPIRED' {
    const valid = [
      'DRAFT',
      'SUBMITTED',
      'AUTOMATED_REVIEW',
      'MANUAL_REVIEW',
      'MORE_INFORMATION_REQUIRED',
      'APPROVED',
      'REJECTED',
      'SUSPENDED',
      'REVOKED',
      'EXPIRED',
    ] as const;
    const match = valid.find((candidate) => candidate === value);
    if (!match) throw new NotFoundException(`Unknown coordinator application status: ${value}`);
    return match;
  }
}
