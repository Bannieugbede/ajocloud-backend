import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

const feedSelect = {
  id: true,
  template: true,
  title: true,
  body: true,
  deepLink: true,
  readAt: true,
  createdAt: true,
} as const;

/**
 * The in-app notification list.
 *
 * Reads only `IN_APP` rows. The same table records email and push attempts,
 * but those are delivery records rather than things to show a user — listing
 * them would surface an email they already received as an unread item.
 */
@Injectable()
export class NotificationFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<unknown> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, channel: NotificationChannel.IN_APP },
      select: feedSelect,
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      unreadCount: await this.unreadCount(userId),
    };
  }

  /** Badge count. Cheap enough to return with the list so the two cannot
      disagree on screen. */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, channel: NotificationChannel.IN_APP, readAt: null },
    });
  }

  /** Marks one notification read. Scoped to the owner: a notification id is not
      a capability to read someone else's inbox. */
  async markRead(userId: string, notificationId: string): Promise<unknown> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId, channel: NotificationChannel.IN_APP },
      select: { id: true, readAt: true },
    });
    if (!notification) throw new NotFoundException('That notification was not found');
    // Already-read stays at its original timestamp: re-marking would rewrite
    // when the user actually saw it.
    if (notification.readAt) return { id: notification.id, readAt: notification.readAt };
    return this.prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
      select: { id: true, readAt: true },
    });
  }

  async markAllRead(userId: string): Promise<{ readonly updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, channel: NotificationChannel.IN_APP, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
