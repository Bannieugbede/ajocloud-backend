import { NotFoundException } from '@nestjs/common';
import { NotificationChannel } from '../../../generated/prisma/enums.js';
import { firstArg } from '../../common/testing/mock-arguments.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { NotificationFeedService } from './notification-feed.service.js';

function build() {
  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'n-1', readAt: null }),
      update: jest.fn().mockResolvedValue({ id: 'n-1', readAt: new Date() }),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      count: jest.fn().mockResolvedValue(2),
    },
  };
  return { prisma, service: new NotificationFeedService(prisma as unknown as PrismaService) };
}

describe('NotificationFeedService', () => {
  it('lists only in-app rows', async () => {
    // The same table records email and push attempts; listing those would show
    // an email the user already received as an unread item.
    const { service, prisma } = build();
    await service.list('user-1', { limit: 25 });
    const query = firstArg<{ where: { channel: string; userId: string } }>(
      prisma.notification.findMany,
    );
    expect(query.where.channel).toBe(NotificationChannel.IN_APP);
    expect(query.where.userId).toBe('user-1');
  });

  it('pages with a cursor and reports the next one', async () => {
    const { service, prisma } = build();
    prisma.notification.findMany.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({ id: `n-${String(index)}` })),
    );
    const result = (await service.list('user-1', { limit: 2 })) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('n-1');
  });

  it('reports no next cursor on the last page', async () => {
    const { service, prisma } = build();
    prisma.notification.findMany.mockResolvedValue([{ id: 'n-0' }]);
    const result = (await service.list('user-1', { limit: 25 })) as { nextCursor: string | null };
    expect(result.nextCursor).toBeNull();
  });

  it('returns the unread count alongside the list, so the two cannot disagree', async () => {
    const { service } = build();
    const result = (await service.list('user-1', { limit: 25 })) as { unreadCount: number };
    expect(result.unreadCount).toBe(2);
  });

  it('refuses to mark another user notification read', async () => {
    // A notification id is not a capability to read someone else's inbox.
    const { service, prisma } = build();
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead('user-1', 'n-9')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('keeps the original timestamp when re-marking a read notification', async () => {
    const readAt = new Date('2026-09-01T10:00:00.000Z');
    const { service, prisma } = build();
    prisma.notification.findFirst.mockResolvedValue({ id: 'n-1', readAt });
    await expect(service.markRead('user-1', 'n-1')).resolves.toEqual({ id: 'n-1', readAt });
    // Rewriting it would lose when the user actually saw the notification.
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('marks only unread rows when clearing the badge', async () => {
    const { service, prisma } = build();
    await expect(service.markAllRead('user-1')).resolves.toEqual({ updated: 3 });
    const query = firstArg<{ where: { readAt: null } }>(prisma.notification.updateMany);
    expect(query.where.readAt).toBeNull();
  });
});
