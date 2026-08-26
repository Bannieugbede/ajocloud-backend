import { EngagementService } from './engagement.service.js';
import type { JoinWaitlistDto } from './dto/join-waitlist.dto.js';

const FIRST_JOINED_AT = new Date('2026-01-05T09:00:00.000Z');

interface Row {
  id: string;
  email: string;
  createdAt: Date;
}

function build(existing: Row | null) {
  const upserted: Row = existing ?? {
    id: 'entry-new',
    email: 'ada@example.com',
    createdAt: new Date('2026-08-26T10:00:00.000Z'),
  };
  const prisma = {
    waitlistEntry: {
      findUnique: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockResolvedValue(upserted),
    },
  };
  return { service: new EngagementService(prisma as never), prisma };
}

const dto = (overrides: Partial<JoinWaitlistDto> = {}): JoinWaitlistDto => ({
  firstName: 'Ada',
  lastName: 'Okafor',
  email: 'ada@example.com',
  phone: '+2348012345678',
  wantsPromotions: false,
  ...overrides,
});

describe('EngagementService.joinWaitlist', () => {
  it('reports a first-time submission as JOINED', async () => {
    const { service } = build(null);
    await expect(service.joinWaitlist(dto())).resolves.toMatchObject({
      id: 'entry-new',
      status: 'JOINED',
    });
  });

  it('reports a repeat submission as ALREADY_JOINED rather than failing', async () => {
    // The complaint this fixes: re-submitting an address surfaced as an error
    // even though the entry was saved. It is a success with a different message.
    const { service } = build({
      id: 'entry-1',
      email: 'ada@example.com',
      createdAt: FIRST_JOINED_AT,
    });
    await expect(service.joinWaitlist(dto())).resolves.toEqual({
      id: 'entry-1',
      email: 'ada@example.com',
      status: 'ALREADY_JOINED',
      joinedAt: FIRST_JOINED_AT.toISOString(),
    });
  });

  it('keeps the original join date when details are updated', async () => {
    // Someone correcting a typo'd phone must not lose their place in the queue.
    const { service } = build({
      id: 'entry-1',
      email: 'ada@example.com',
      createdAt: FIRST_JOINED_AT,
    });
    const result = await service.joinWaitlist(dto({ phone: '+2349087654321' }));
    expect(result.joinedAt).toBe(FIRST_JOINED_AT.toISOString());
  });

  it('matches an existing entry regardless of the casing typed', async () => {
    const { service, prisma } = build(null);
    await service.joinWaitlist(dto({ email: '  Ada@Example.COM ' }));
    expect(prisma.waitlistEntry.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ada@example.com' } }),
    );
  });
});
