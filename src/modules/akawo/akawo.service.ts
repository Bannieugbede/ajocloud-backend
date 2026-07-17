import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  PaymentStatus,
  SavingsGoalStatus,
  SavingsGoalType,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import type { AkawoStatementQueryDto } from './dto/akawo-statement-query.dto.js';
import type { CreateAkawoGoalDto } from './dto/create-akawo-goal.dto.js';
import type { CreateAkawoScheduleDto } from './dto/create-akawo-schedule.dto.js';

const goalSelect = {
  id: true,
  name: true,
  type: true,
  targetMinor: true,
  currency: true,
  status: true,
  targetDate: true,
  maturityAt: true,
  autoSaveEnabled: true,
  reminderEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AkawoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  async create(userId: string, dto: CreateAkawoGoalDto): Promise<unknown> {
    if (dto.type === SavingsGoalType.LOCKED)
      throw new UnprocessableEntityException('Locked Akawo goals are not available yet');
    if (dto.type === SavingsGoalType.TARGET && !dto.targetMinor)
      throw new UnprocessableEntityException('Target amount is required for a target goal');
    const targetDate = dto.targetDate ? new Date(dto.targetDate) : undefined;
    if (targetDate && targetDate <= new Date())
      throw new UnprocessableEntityException('Target date must be in the future');

    return this.transactions.serializable(async (tx) => {
      const created = await tx.savingsGoal.create({
        data: {
          userId,
          name: dto.name,
          type: dto.type,
          targetMinor: BigInt(dto.targetMinor ?? '0'),
          status: SavingsGoalStatus.ACTIVE,
          ...(targetDate ? { targetDate } : {}),
          withdrawalRule: {
            create: {
              type: dto.type === SavingsGoalType.FLEXIBLE ? 'FLEXIBLE' : 'TARGET_REACHED',
            },
          },
        },
        select: goalSelect,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'akawo.goal.created',
          subjectType: 'SavingsGoal',
          subjectId: created.id,
          metadata: { type: created.type },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'SavingsGoal',
          aggregateId: created.id,
          eventType: 'akawo.goal.created',
          payload: { goalId: created.id, type: created.type },
        },
      });
      return this.serialize(created);
    });
  }

  async list(userId: string): Promise<unknown[]> {
    const goals = await this.prisma.savingsGoal.findMany({
      where: { userId, status: { not: SavingsGoalStatus.CANCELLED } },
      select: goalSelect,
      orderBy: { createdAt: 'desc' },
    });
    const totals = await this.contributionTotals(goals.map((goal) => goal.id));
    return goals.map((goal) => this.publicGoal(goal, totals.get(goal.id) ?? 0n));
  }

  async get(userId: string, goalId: string): Promise<unknown> {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id: goalId, userId },
      select: goalSelect,
    });
    if (!goal) throw new NotFoundException('Akawo goal was not found');
    const totals = await this.contributionTotals([goal.id]);
    return this.publicGoal(goal, totals.get(goal.id) ?? 0n);
  }

  async statement(userId: string, goalId: string, query: AkawoStatementQueryDto): Promise<unknown> {
    await this.requireOwner(userId, goalId);
    const rows = await this.prisma.savingsContribution.findMany({
      where: { goalId },
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        status: true,
        createdAt: true,
        ledgerTransactionId: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return this.serialize({
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    });
  }

  async createSchedule(
    userId: string,
    goalId: string,
    dto: CreateAkawoScheduleDto,
  ): Promise<unknown> {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id: goalId, userId, status: SavingsGoalStatus.ACTIVE },
      select: { id: true, currency: true },
    });
    if (!goal) throw new NotFoundException('Active Akawo goal was not found');
    const dueAt = new Date(dto.dueAt);
    if (dueAt <= new Date())
      throw new UnprocessableEntityException('Schedule date must be in the future');
    const schedule = await this.prisma.savingsSchedule.create({
      data: { goalId, amountMinor: BigInt(dto.amountMinor), currency: goal.currency, dueAt },
      select: {
        id: true,
        goalId: true,
        amountMinor: true,
        currency: true,
        dueAt: true,
        status: true,
      },
    });
    return this.serialize(schedule);
  }

  private async requireOwner(userId: string, goalId: string): Promise<void> {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id: goalId, userId },
      select: { id: true },
    });
    if (!goal) throw new NotFoundException('Akawo goal was not found');
  }

  private async contributionTotals(goalIds: string[]): Promise<Map<string, bigint>> {
    if (goalIds.length === 0) return new Map();
    const totals = await this.prisma.savingsContribution.groupBy({
      by: ['goalId'],
      where: { goalId: { in: goalIds }, status: PaymentStatus.SUCCEEDED },
      _sum: { amountMinor: true },
    });
    return new Map(totals.map((row) => [row.goalId, row._sum.amountMinor ?? 0n]));
  }

  private publicGoal<T extends { targetMinor: bigint }>(goal: T, savedMinor: bigint): unknown {
    const progressBps =
      goal.targetMinor > 0n
        ? Number(
            (savedMinor * 10_000n) / goal.targetMinor > 10_000n
              ? 10_000n
              : (savedMinor * 10_000n) / goal.targetMinor,
          )
        : null;
    return this.serialize({ ...goal, savedMinor, progressBps });
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
      ),
    ) as T;
  }
}
