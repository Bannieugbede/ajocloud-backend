import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FoodAjoStatus,
  FoodCoordinatorApplicationStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import type { CreateFoodProgrammeDto } from './dto/create-food-programme.dto.js';
import type { FoodProgrammeQueryDto } from './dto/food-programme-query.dto.js';

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

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
      ),
    ) as T;
  }
}
