import { NotFoundException } from '@nestjs/common';
import { AkawoPoolsService } from './akawo-pools.service.js';

const ORGANISER = 'organiser-1';

function build(pool: Record<string, unknown>) {
  const prisma = {
    akawoPool: {
      findUnique: jest.fn().mockResolvedValue(pool),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ ...pool, ...data })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const tx = {
    akawoPoolMember: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    akawoPoolDue: { create: jest.fn().mockResolvedValue({ id: 'due-1' }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const transactions = {
    serializable: <T>(work: (client: unknown) => Promise<T>): Promise<T> => work(tx),
  };
  return { service: new AkawoPoolsService(prisma as never, transactions as never), prisma, tx };
}

const pool = {
  id: 'pool-1',
  organiserUserId: ORGANISER,
  name: 'Class of 2026 dues',
  status: 'OPEN',
  amountMinor: 500_000n,
  currency: 'NGN',
  referenceLabel: 'Matric number',
  shortCode: '7KQ3MZP',
  publiclyListed: false,
  organiser: { profile: null },
};

describe('listing an Akawo pool', () => {
  it('lets the organiser list the pool, and records it', async () => {
    const { service, prisma } = build(pool);
    await service.update(ORGANISER, 'pool-1', { publiclyListed: true });
    expect(prisma.akawoPool.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { publiclyListed: true } }),
    );
    const [[audit]] = prisma.auditLog.create.mock.calls as [[{ data: { action: string } }]];
    expect(audit.data.action).toBe('akawo.pool.listed');
  });

  it('writes no audit entry when an edit leaves the listing alone', async () => {
    const { service, prisma } = build(pool);
    await service.update(ORGANISER, 'pool-1', { name: 'Class of 2026 levy' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('joining by public code', () => {
  const details = { fullName: 'Tunde Bello', reference: 'MAT/2026/001' };

  it('admits anyone to a listed pool with its public code', async () => {
    const { service, tx } = build({ ...pool, publiclyListed: true });
    await service.join('user-9', { joinCode: '7kq3mzp', ...details });
    expect(tx.akawoPoolMember.create).toHaveBeenCalled();
  });

  it('refuses the public code of an unlisted pool, like a wrong code', async () => {
    const { service, tx } = build(pool);
    await expect(
      service.join('user-9', { joinCode: '7KQ3MZP', ...details }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.akawoPoolMember.create).not.toHaveBeenCalled();
  });
});
