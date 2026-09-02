import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FoodAjoStatus,
  FoodCoordinatorApplicationStatus,
  FoodSubscriptionStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import type { CreateFoodProgrammeDto } from './dto/create-food-programme.dto.js';
import type { FoodProgrammeQueryDto } from './dto/food-programme-query.dto.js';
import type { SubscribeFoodProgrammeDto } from './dto/subscribe-food-programme.dto.js';
import { assertCanSubscribe, canCancelSubscription } from './domain/food-ajo-policy.js';

const programmeSelect = {
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
  plannedProcurementAt: true,
  distributionAt: true,
  packages: {
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      priceMinor: true,
      priceLockedAt: true,
      currency: true,
      items: { select: { id: true, name: true, quantity: true, unit: true } },
    },
  },
  _count: { select: { subscriptions: true } },
} as const;

@Injectable()
export class FoodAjoProgrammesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  async create(userId: string, dto: CreateFoodProgrammeDto): Promise<unknown> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw new UnprocessableEntityException('End date must follow start date');
    if (dto.distributionAt && new Date(dto.distributionAt) < startsAt)
      throw new UnprocessableEntityException('Distribution cannot precede the programme');

    const approval = await this.prisma.foodCoordinatorApplication.findFirst({
      where: {
        userId,
        status: FoodCoordinatorApplicationStatus.APPROVED,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!approval) throw new ForbiddenException('An active coordinator approval is required');

    return this.transactions.serializable(async (tx) => {
      const created = await tx.foodAjoGroup.create({
        data: {
          coordinatorUserId: userId,
          name: dto.name,
          contributionMinor: BigInt(dto.contributionMinor),
          contributionFrequency: dto.contributionFrequency,
          enrolmentCapacity: dto.enrolmentCapacity,
          fulfilmentMethod: dto.fulfilmentMethod,
          startsAt,
          endsAt,
          ...(dto.plannedProcurementAt
            ? { plannedProcurementAt: new Date(dto.plannedProcurementAt) }
            : {}),
          ...(dto.distributionAt ? { distributionAt: new Date(dto.distributionAt) } : {}),
          packages: {
            create: dto.packages.map((foodPackage) => ({
              name: foodPackage.name,
              priceMinor: BigInt(foodPackage.priceMinor),
              items: {
                create: foodPackage.items.map((item) => ({
                  name: item.name,
                  quantity: item.quantity,
                  unit: item.unit,
                })),
              },
            })),
          },
        },
        select: programmeSelect,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'food.programme.created',
          subjectType: 'FoodAjoGroup',
          subjectId: created.id,
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'FoodAjoGroup',
          aggregateId: created.id,
          eventType: 'food.programme.created',
          payload: { programmeId: created.id },
        },
      });
      return this.serialize(created);
    });
  }

  async list(userId: string, query: FoodProgrammeQueryDto): Promise<unknown> {
    const programmes = await this.prisma.foodAjoGroup.findMany({
      where: {
        OR: [
          { status: { in: [FoodAjoStatus.OPEN, FoodAjoStatus.ACTIVE] } },
          { coordinatorUserId: userId },
          { subscriptions: { some: { userId } } },
        ],
      },
      select: programmeSelect,
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = programmes.length > query.limit;
    const items = programmes.slice(0, query.limit);
    return this.serialize({
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    });
  }

  async get(userId: string, programmeId: string): Promise<unknown> {
    const programme = await this.prisma.foodAjoGroup.findUnique({
      where: { id: programmeId },
      select: programmeSelect,
    });
    if (!programme) throw new NotFoundException('Food Ajo programme was not found');
    const visible =
      programme.coordinatorUserId === userId ||
      programme.status === FoodAjoStatus.OPEN ||
      programme.status === FoodAjoStatus.ACTIVE ||
      (await this.prisma.foodSubscription.findFirst({
        where: { groupId: programmeId, userId },
        select: { id: true },
      }));
    if (!visible) throw new NotFoundException('Food Ajo programme was not found');
    return this.serialize(programme);
  }

  /**
   * Enrols the caller in one of a programme's packages.
   *
   * Runs serializable because capacity is checked and consumed in the same
   * step: two members taking the last place concurrently would both pass a
   * read-then-write check at a weaker isolation level.
   */
  async subscribe(
    userId: string,
    programmeId: string,
    dto: SubscribeFoodProgrammeDto,
  ): Promise<unknown> {
    const created = await this.transactions.serializable(async (tx) => {
      const programme = await tx.foodAjoGroup.findUnique({
        where: { id: programmeId },
        select: {
          id: true,
          status: true,
          enrolmentCapacity: true,
          fulfilmentMethod: true,
        },
      });
      if (!programme) throw new NotFoundException('Food Ajo programme was not found');

      const pkg = await tx.foodPackage.findUnique({
        where: { id: dto.packageId },
        select: { id: true, groupId: true, isActive: true },
      });
      // Counts portions, not members: a member holding three consumes three.
      const enrolled = await tx.foodSubscription.aggregate({
        where: {
          groupId: programmeId,
          status: { in: [FoodSubscriptionStatus.PENDING, FoodSubscriptionStatus.ACTIVE] },
        },
        _sum: { quantity: true },
      });
      const existing = await tx.foodSubscription.findUnique({
        where: {
          groupId_userId_packageId: {
            groupId: programmeId,
            userId,
            packageId: dto.packageId,
          },
        },
        select: { id: true, status: true },
      });

      assertCanSubscribe({
        status: programme.status,
        capacity: programme.enrolmentCapacity,
        enrolled: enrolled._sum.quantity ?? 0,
        quantity: dto.quantity,
        packageBelongsToProgramme: pkg?.groupId === programmeId,
        packageIsActive: pkg?.isActive === true,
        // A withdrawn subscription may be taken up again; only a live one blocks.
        alreadySubscribed: Boolean(existing && canCancelSubscription(existing.status)),
      });

      const subscription = existing
        ? await tx.foodSubscription.update({
            where: { id: existing.id },
            data: {
              status: FoodSubscriptionStatus.PENDING,
              quantity: dto.quantity,
              fulfilmentMethod: dto.fulfilmentMethod ?? programme.fulfilmentMethod,
            },
          })
        : await tx.foodSubscription.create({
            data: {
              groupId: programmeId,
              packageId: dto.packageId,
              userId,
              quantity: dto.quantity,
              fulfilmentMethod: dto.fulfilmentMethod ?? programme.fulfilmentMethod,
            },
          });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'food.subscription.created',
          subjectType: 'FoodSubscription',
          subjectId: subscription.id,
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'FoodSubscription',
          aggregateId: subscription.id,
          eventType: 'food.subscription.created',
          payload: { programmeId, subscriptionId: subscription.id },
        },
      });
      return subscription;
    });
    return this.serialize(created);
  }

  /** Withdraws the caller's own subscription while it is still unfulfilled. */
  async cancelSubscription(userId: string, programmeId: string): Promise<unknown> {
    const cancelled = await this.transactions.serializable(async (tx) => {
      const subscription = await tx.foodSubscription.findFirst({
        where: { groupId: programmeId, userId },
        select: { id: true, status: true },
      });
      if (!subscription) throw new NotFoundException('You are not enrolled in this programme');
      if (!canCancelSubscription(subscription.status)) {
        throw new ConflictException('This enrolment can no longer be withdrawn');
      }
      const updated = await tx.foodSubscription.update({
        where: { id: subscription.id },
        data: { status: FoodSubscriptionStatus.CANCELLED },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'food.subscription.cancelled',
          subjectType: 'FoodSubscription',
          subjectId: subscription.id,
        },
      });
      return updated;
    });
    return this.serialize(cancelled);
  }

  /** The caller's own enrolments, so a screen can show what they joined. */
  async mySubscriptions(userId: string): Promise<unknown> {
    const subscriptions = await this.prisma.foodSubscription.findMany({
      where: { userId },
      select: {
        id: true,
        groupId: true,
        packageId: true,
        status: true,
        quantity: true,
        fulfilmentMethod: true,
        createdAt: true,
        group: { select: { name: true, status: true, distributionAt: true } },
        package: { select: { name: true, priceMinor: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.serialize(subscriptions);
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
      ),
    ) as T;
  }
}
