import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { LISTINGS_PER_KIND, PublicListingsService } from './public-listings.service.js';

describe('PublicListingsService', () => {
  const row = {
    shortCode: '7KQ3MZP',
    name: 'A group',
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  };
  const prisma = {
    ajoGroup: { findMany: jest.fn().mockResolvedValue([row]) },
    akawoPool: { findMany: jest.fn().mockResolvedValue([]) },
    foodAjoGroup: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new PublicListingsService(prisma as unknown as PrismaService);

  it('lists only listed Ajo groups still taking members', async () => {
    await service.list();
    expect(prisma.ajoGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { publiclyListed: true, deletedAt: null, status: { in: ['DRAFT', 'OPEN'] } },
        take: LISTINGS_PER_KIND,
      }),
    );
  });

  it('lists only listed, open Akawo pools', async () => {
    await service.list();
    expect(prisma.akawoPool.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publiclyListed: true, status: 'OPEN' } }),
    );
  });

  it('lists Food programmes a member could already find in the app', async () => {
    await service.list();
    expect(prisma.foodAjoGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['OPEN', 'ACTIVE'] } } }),
    );
  });

  it('returns codes, names and dates, and nothing that identifies a record', async () => {
    const listings = await service.list();
    expect(listings.ajoGroups).toEqual([
      { shortCode: '7KQ3MZP', name: 'A group', updatedAt: '2026-09-01T00:00:00.000Z' },
    ]);
  });

  it('stays inside one sitemap', () => {
    expect(LISTINGS_PER_KIND * 3).toBeLessThan(50_000);
  });
});
