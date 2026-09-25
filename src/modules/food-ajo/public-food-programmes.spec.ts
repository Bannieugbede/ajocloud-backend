import { NotFoundException } from '@nestjs/common';
import { FoodAjoStatus, KycStatus, KycTier } from '../../../generated/prisma/enums.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { FoodAjoProgrammesService } from './food-ajo-programmes.service.js';

describe('the public Food programme preview', () => {
  const prisma = {
    foodAjoGroup: { findUnique: jest.fn() },
    userProfile: { findMany: jest.fn() },
    kycProfile: { findMany: jest.fn() },
  };
  const service = new FoodAjoProgrammesService(
    prisma as unknown as PrismaService,
    {} as TransactionService,
  );

  const programme = {
    id: 'programme-1',
    coordinatorUserId: 'coordinator-1',
    name: 'Family staples',
    status: FoodAjoStatus.OPEN,
    currency: 'NGN',
    contributionMinor: 1_000_000n,
    packages: [{ id: 'package-1', name: 'Rice and beans', priceMinor: 4_000_000n, items: [] }],
    _count: { subscriptions: 12 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userProfile.findMany.mockResolvedValue([
      { userId: 'coordinator-1', firstName: 'Bola', lastName: 'Ade' },
    ]);
    prisma.kycProfile.findMany.mockResolvedValue([
      { userId: 'coordinator-1', tier: KycTier.TIER_3, status: KycStatus.VERIFIED },
    ]);
  });

  it('describes an open programme with its coordinator, but not their user id', async () => {
    prisma.foodAjoGroup.findUnique.mockResolvedValue(programme);
    const preview = (await service.publicPreview('programme-1')) as Record<string, unknown>;
    expect(preview).toMatchObject({
      id: 'programme-1',
      name: 'Family staples',
      contributionMinor: '1000000',
      coordinatorName: 'Bola Ade',
      coordinatorVerified: true,
    });
    expect(preview).not.toHaveProperty('coordinatorUserId');
    expect(preview).not.toHaveProperty('_count');
  });

  it('describes an active programme too', async () => {
    prisma.foodAjoGroup.findUnique.mockResolvedValue({
      ...programme,
      status: FoodAjoStatus.ACTIVE,
    });
    await expect(service.publicPreview('programme-1')).resolves.toMatchObject({
      name: 'Family staples',
    });
  });

  it.each(
    Object.values(FoodAjoStatus).filter(
      (status) => status !== FoodAjoStatus.OPEN && status !== FoodAjoStatus.ACTIVE,
    ),
  )('reports a %s programme exactly like a missing one', async (status) => {
    prisma.foodAjoGroup.findUnique.mockResolvedValue({ ...programme, status });
    await expect(service.publicPreview('programme-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports a missing programme as not found', async () => {
    prisma.foodAjoGroup.findUnique.mockResolvedValue(null);
    await expect(service.publicPreview('programme-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
