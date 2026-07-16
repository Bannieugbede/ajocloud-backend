import { ForbiddenException } from '@nestjs/common';
import { ContributionFrequency, FoodFulfilmentMethod } from '../../../generated/prisma/enums.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { FoodAjoProgrammesService } from './food-ajo-programmes.service.js';

describe('FoodAjoProgrammesService', () => {
  const prisma = {
    foodCoordinatorApplication: { findFirst: jest.fn() },
    foodAjoGroup: { findMany: jest.fn(), findUnique: jest.fn() },
    foodSubscription: { findFirst: jest.fn() },
  };
  const transactions = { serializable: jest.fn() };
  const service = new FoodAjoProgrammesService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
  );
  const input = {
    name: 'Family staples',
    contributionMinor: '1000000',
    contributionFrequency: ContributionFrequency.MONTHLY,
    enrolmentCapacity: 50,
    fulfilmentMethod: FoodFulfilmentMethod.PICKUP,
    startsAt: '2026-08-01',
    endsAt: '2026-12-01',
    packages: [
      {
        name: 'Rice and beans',
        priceMinor: '4000000',
        items: [{ name: 'Rice', quantity: '10.000', unit: 'kg' }],
      },
    ],
  };

  beforeEach(() => jest.clearAllMocks());

  it('requires a current approved coordinator application', async () => {
    prisma.foodCoordinatorApplication.findFirst.mockResolvedValue(null);
    await expect(service.create('user-id', input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactions.serializable).not.toHaveBeenCalled();
  });

  it('creates the programme, package, audit record, and outbox event atomically', async () => {
    prisma.foodCoordinatorApplication.findFirst.mockResolvedValue({ id: 'approval-id' });
    const tx = {
      foodAjoGroup: {
        create: jest.fn().mockResolvedValue({
          id: 'programme-id',
          coordinatorUserId: 'user-id',
          name: input.name,
          contributionMinor: 1_000_000n,
          packages: [],
        }),
      },
      auditLog: { create: jest.fn() },
      outboxEvent: { create: jest.fn() },
    };
    transactions.serializable.mockImplementation(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    );

    await expect(service.create('user-id', input)).resolves.toEqual(
      expect.objectContaining({ id: 'programme-id', contributionMinor: '1000000' }),
    );
    expect(tx.foodAjoGroup.create).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.outboxEvent.create).toHaveBeenCalled();
  });
});
