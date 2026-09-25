import { NotFoundException } from '@nestjs/common';
import { AkawoPoolsService } from './akawo-pools.service.js';

const CODE = 'ABCDEFGH';

function build(pool: Record<string, unknown> | null) {
  const prisma = { akawoPool: { findUnique: jest.fn().mockResolvedValue(pool) } };
  const service = new AkawoPoolsService(prisma as never, {} as never);
  return { service, prisma };
}

const openPool = {
  id: 'pool-1',
  name: 'Class of 2026 dues',
  purpose: 'Graduation dinner',
  amountMinor: 5_000_00n,
  currency: 'NGN',
  status: 'OPEN',
  referenceLabel: 'Matric number',
  dueAt: new Date('2026-10-01T00:00:00Z'),
  organiser: { profile: { firstName: 'Ada', lastName: 'Obi' } },
};

describe('the public pool preview', () => {
  it('describes an open pool without its id', async () => {
    const { service } = build(openPool);
    const preview = (await service.publicPreview(CODE)) as Record<string, unknown>;
    expect(preview).toEqual({
      name: 'Class of 2026 dues',
      purpose: 'Graduation dinner',
      amountMinor: '500000',
      currency: 'NGN',
      referenceLabel: 'Matric number',
      dueAt: '2026-10-01T00:00:00.000Z',
      organiserName: 'Ada Obi',
    });
    expect(preview).not.toHaveProperty('id');
  });

  it.each(['CLOSED', 'CANCELLED', 'DRAFT'])(
    'reports a %s pool exactly like an unknown code',
    async (status) => {
      const { service } = build({ ...openPool, status });
      const closed = service.publicPreview(CODE);
      await expect(closed).rejects.toBeInstanceOf(NotFoundException);
      await expect(closed).rejects.toThrow('That join code was not recognised');
    },
  );

  it('refuses a malformed code before looking anything up', async () => {
    const { service, prisma } = build(openPool);
    await expect(service.publicPreview('../../x')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.akawoPool.findUnique).not.toHaveBeenCalled();
  });

  it('names the organiser generically when they have no profile', async () => {
    const { service } = build({ ...openPool, organiser: { profile: null } });
    const preview = (await service.publicPreview(CODE)) as Record<string, unknown>;
    expect(preview.organiserName).toBe('Pool organiser');
  });
});
