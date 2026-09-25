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

  const ID = '11111111-2222-4333-8444-555555555555';
  const programme = {
    id: ID,
    shortCode: '7KQ3MZP',
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
    const preview = (await service.publicPreview(ID)) as Record<string, unknown>;
    expect(preview).toMatchObject({
      id: ID,
      shortCode: '7KQ3MZP',
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
    await expect(service.publicPreview(ID)).resolves.toMatchObject({
      name: 'Family staples',
    });
  });

  it.each(
    Object.values(FoodAjoStatus).filter(
      (status) => status !== FoodAjoStatus.OPEN && status !== FoodAjoStatus.ACTIVE,
    ),
  )('reports a %s programme exactly like a missing one', async (status) => {
    prisma.foodAjoGroup.findUnique.mockResolvedValue({ ...programme, status });
    await expect(service.publicPreview(ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports a missing programme as not found', async () => {
    prisma.foodAjoGroup.findUnique.mockResolvedValue(null);
    await expect(service.publicPreview(ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('finds a programme by its short code, as ajocloud.com/f/<code> carries it', async () => {
    prisma.foodAjoGroup.findUnique.mockResolvedValue(programme);
    await service.publicPreview('7kq3mzp');
    expect(prisma.foodAjoGroup.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { shortCode: '7KQ3MZP' } }),
    );
  });

  it('still finds a programme by id, for links shared before short codes', async () => {
    prisma.foodAjoGroup.findUnique.mockResolvedValue(programme);
    await service.publicPreview(ID);
    expect(prisma.foodAjoGroup.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID } }),
    );
  });

  it('refuses anything that is neither, before looking it up', async () => {
    await expect(service.publicPreview('../wallet')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.foodAjoGroup.findUnique).not.toHaveBeenCalled();
  });
});
