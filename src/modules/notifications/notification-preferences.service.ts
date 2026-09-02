import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { NotificationChannel } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { isValidQuietHours } from './domain/notification-policy.js';
import { NOTIFICATION_TOPICS, type NotificationTopic } from './domain/notification-topics.js';

/**
 * Channels a user can currently express a preference about.
 *
 * PUSH and IN_APP are excluded: nothing delivers on them yet, and offering a
 * switch for a channel that never sends would misrepresent what the app does.
 */
const SETTABLE_CHANNELS = [NotificationChannel.EMAIL, NotificationChannel.SMS] as const;

const DEFAULT_TIMEZONE = 'Africa/Lagos';

export interface NotificationPreferenceView {
  readonly topic: NotificationTopic;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly quietHoursStartMinutes: number | null;
  readonly quietHoursEndMinutes: number | null;
  readonly timezone: string;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every settable topic and channel, with the user's choice where they made
   * one and the default where they did not.
   *
   * The full grid is returned rather than only stored rows so the client never
   * has to know the catalogue or guess a default. Preferences are opt-out, so
   * an absent row means enabled.
   */
  async list(userId: string): Promise<{
    readonly preferences: NotificationPreferenceView[];
    readonly timezone: string;
  }> {
    const [stored, profile] = await Promise.all([
      this.prisma.notificationPreference.findMany({
        where: { userId, channel: { in: [...SETTABLE_CHANNELS] } },
      }),
      this.prisma.userProfile.findUnique({
        where: { userId },
        select: { timezone: true },
      }),
    ]);
    const timezone = profile?.timezone ?? DEFAULT_TIMEZONE;

    const preferences = NOTIFICATION_TOPICS.flatMap((topic) =>
      SETTABLE_CHANNELS.map((channel) => {
        const match = stored.find((row) => row.topic === topic && row.channel === channel);
        return {
          topic,
          channel,
          enabled: match?.enabled ?? true,
          quietHoursStartMinutes: match?.quietHoursStartMinutes ?? null,
          quietHoursEndMinutes: match?.quietHoursEndMinutes ?? null,
          timezone: match?.timezone ?? timezone,
        };
      }),
    );
    return { preferences, timezone };
  }

  /**
   * Applies a batch of changes.
   *
   * Written in one transaction so a partial save cannot leave the settings
   * screen showing a state that was never stored.
   */
  async update(
    userId: string,
    updates: readonly {
      readonly topic: NotificationTopic;
      readonly channel: NotificationChannel;
      readonly enabled: boolean;
      readonly quietHoursStartMinutes?: number | null;
      readonly quietHoursEndMinutes?: number | null;
      readonly timezone?: string;
    }[],
  ): Promise<{
    readonly preferences: NotificationPreferenceView[];
    readonly timezone: string;
  }> {
    for (const update of updates) {
      if (!isValidQuietHours(update.quietHoursStartMinutes, update.quietHoursEndMinutes)) {
        throw new UnprocessableEntityException(
          'Quiet hours need both a start and an end, or neither',
        );
      }
      if (!SETTABLE_CHANNELS.includes(update.channel as (typeof SETTABLE_CHANNELS)[number])) {
        throw new UnprocessableEntityException('That channel cannot be configured yet');
      }
    }

    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const fallbackTimezone = profile?.timezone ?? DEFAULT_TIMEZONE;

    await this.prisma.$transaction(
      updates.map((update) => {
        const timezone = update.timezone ?? fallbackTimezone;
        const quietHours = {
          quietHoursStartMinutes: update.quietHoursStartMinutes ?? null,
          quietHoursEndMinutes: update.quietHoursEndMinutes ?? null,
        };
        return this.prisma.notificationPreference.upsert({
          where: {
            userId_channel_topic: {
              userId,
              channel: update.channel,
              topic: update.topic,
            },
          },
          create: {
            userId,
            channel: update.channel,
            topic: update.topic,
            enabled: update.enabled,
            timezone,
            ...quietHours,
          },
          update: { enabled: update.enabled, timezone, ...quietHours },
        });
      }),
    );

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'notification.preferences.updated',
        subjectType: 'NotificationPreference',
        subjectId: userId,
        // Records what was changed, never the message content it governs.
        metadata: {
          changed: updates.map((update) => `${update.channel}:${update.topic}`),
        },
      },
    });

    return this.list(userId);
  }
}
