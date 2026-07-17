import { UnprocessableEntityException } from '@nestjs/common';
import { SavingsGoalType } from '../../../generated/prisma/enums.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { AkawoService } from './akawo.service.js';

describe('AkawoService', () => {
  const prisma = {
    savingsGoal: { findMany: jest.fn(), findFirst: jest.fn() },
    savingsContribution: { groupBy: jest.fn(), findMany: jest.fn() },
    savingsSchedule: { create: jest.fn() },
  };
  const transactions = { serializable: jest.fn() };
  const service = new AkawoService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects locked goals until withdrawal policy is approved', async () => {
    await expect(
      service.create('user-id', {
        name: 'Locked rent',
        type: SavingsGoalType.LOCKED,
        targetMinor: '100000',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(transactions.serializable).not.toHaveBeenCalled();
  });

  it('returns owner-scoped target progress from succeeded contributions only', async () => {
    prisma.savingsGoal.findMany.mockResolvedValue([
      {
        id: 'goal-id',
        name: 'School fees',
        type: SavingsGoalType.TARGET,
        targetMinor: 100_000n,
        currency: 'NGN',
        status: 'ACTIVE',
        targetDate: null,
        maturityAt: null,
        autoSaveEnabled: false,
        reminderEnabled: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    prisma.savingsContribution.groupBy.mockResolvedValue([
      { goalId: 'goal-id', _sum: { amountMinor: 25_000n } },
    ]);

    await expect(service.list('user-id')).resolves.toEqual([
      expect.objectContaining({
        id: 'goal-id',
        targetMinor: '100000',
        savedMinor: '25000',
        progressBps: 2500,
      }),
    ]);
    expect(prisma.savingsGoal.findMany).toHaveBeenCalledTimes(1);
  });

  it('creates a future savings schedule for an active owner goal', async () => {
    prisma.savingsGoal.findFirst.mockResolvedValue({ id: 'goal-id', currency: 'NGN' });
    prisma.savingsSchedule.create.mockResolvedValue({
      id: 'schedule-id',
      goalId: 'goal-id',
      amountMinor: 25_000n,
      currency: 'NGN',
      dueAt: new Date('2099-01-01T00:00:00Z'),
      status: 'PENDING',
    });

    await expect(
      service.createSchedule('user-id', 'goal-id', {
        amountMinor: '25000',
        dueAt: '2099-01-01T00:00:00Z',
      }),
    ).resolves.toEqual(expect.objectContaining({ amountMinor: '25000', status: 'PENDING' }));
  });

  it('rejects a schedule date in the past', async () => {
    prisma.savingsGoal.findFirst.mockResolvedValue({ id: 'goal-id', currency: 'NGN' });

    await expect(
      service.createSchedule('user-id', 'goal-id', {
        amountMinor: '25000',
        dueAt: '2020-01-01T00:00:00Z',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.savingsSchedule.create).not.toHaveBeenCalled();
  });
});
