import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationStatus,
} from '../../../generated/prisma/enums.js';

/**
 * Notification history and per-user channel preferences.
 *
 * `NotificationTemplate` is deliberately not seeded: templates are defined in
 * code (`src/modules/notifications/templates`) and rendered at send time, and
 * nothing reads that table. Seeding it would create a second, misleading source
 * of truth. `AdminNotification` is likewise left alone — it is derived from live
 * conditions by the console's sync endpoint, which dedupes by subject.
 */

const DEDUPE_PREFIX = 'seed:notification:';

export async function seedNotifications(prisma: PrismaClient): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { email: 'ada.admin@example.test' } });
  if (!admin) return;

  // Quiet hours are stored as minutes from midnight in the user's timezone:
  // 21:00 to 07:00 here, so the policy has a non-trivial case to exercise.
  const preferences = [
    { channel: NotificationChannel.EMAIL, topic: 'ajo.contribution', enabled: true },
    { channel: NotificationChannel.EMAIL, topic: 'ajo.payout', enabled: true },
    { channel: NotificationChannel.SMS, topic: 'ajo.contribution', enabled: false },
    { channel: NotificationChannel.PUSH, topic: 'akawo.progress', enabled: true },
    { channel: NotificationChannel.IN_APP, topic: 'security', enabled: true },
  ] as const;

  for (const preference of preferences) {
    await prisma.notificationPreference.upsert({
      where: {
        userId_channel_topic: {
          userId: admin.id,
          channel: preference.channel,
          topic: preference.topic,
        },
      },
      update: {},
      create: {
        userId: admin.id,
        channel: preference.channel,
        topic: preference.topic,
        enabled: preference.enabled,
        quietHoursStartMinutes: 21 * 60,
        quietHoursEndMinutes: 7 * 60,
        timezone: 'Africa/Lagos',
      },
    });
  }

  // One of each meaningful outcome: delivered, sent-not-yet-confirmed, and a
  // failure with a retry scheduled, so the delivery surface shows all three.
  const notifications = [
    {
      suffix: 'welcome',
      template: 'welcome',
      channel: NotificationChannel.EMAIL,
      status: NotificationStatus.DELIVERED,
      payload: { firstName: 'Ada' },
      sentAt: new Date('2026-07-16T09:00:00Z'),
      delivery: {
        status: NotificationDeliveryStatus.DELIVERED,
        sentAt: new Date('2026-07-16T09:00:01Z'),
        deliveredAt: new Date('2026-07-16T09:00:04Z'),
      },
    },
    {
      suffix: 'contribution-due',
      template: 'ajo-contribution-due',
      channel: NotificationChannel.EMAIL,
      status: NotificationStatus.SENT,
      payload: { groupName: 'Lagos Market Friends Test Ajo', amount: '₦25,000.00' },
      sentAt: new Date('2026-07-30T08:00:00Z'),
      delivery: {
        status: NotificationDeliveryStatus.SENT,
        sentAt: new Date('2026-07-30T08:00:01Z'),
        deliveredAt: null,
      },
    },
    {
      suffix: 'goal-progress',
      template: 'akawo-goal-progress',
      channel: NotificationChannel.PUSH,
      status: NotificationStatus.FAILED,
      payload: { goalName: 'Annual Rent', progress: '25%' },
      sentAt: null,
      delivery: {
        status: NotificationDeliveryStatus.RETRY_SCHEDULED,
        sentAt: null,
        deliveredAt: null,
        failureCode: 'DEVICE_TOKEN_STALE',
        failureReason: 'The stored push token was rejected by the provider.',
        nextAttemptAt: new Date('2026-08-01T09:00:00Z'),
      },
    },
  ] as const;

  for (const item of notifications) {
    const dedupeKey = `${DEDUPE_PREFIX}${item.suffix}`;
    const notification = await prisma.notification.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        userId: admin.id,
        channel: item.channel,
        template: item.template,
        status: item.status,
        payload: item.payload,
        dedupeKey,
        ...(item.sentAt ? { sentAt: item.sentAt } : {}),
      },
    });

    await prisma.notificationDelivery.upsert({
      where: {
        notificationId_attemptNumber: { notificationId: notification.id, attemptNumber: 1 },
      },
      update: {},
      create: {
        notificationId: notification.id,
        provider: 'console',
        providerReference: `seed-${item.suffix}`,
        attemptNumber: 1,
        status: item.delivery.status,
        ...(item.delivery.sentAt ? { sentAt: item.delivery.sentAt } : {}),
        ...(item.delivery.deliveredAt ? { deliveredAt: item.delivery.deliveredAt } : {}),
        ...('failureCode' in item.delivery ? { failureCode: item.delivery.failureCode } : {}),
        ...('failureReason' in item.delivery ? { failureReason: item.delivery.failureReason } : {}),
        ...('nextAttemptAt' in item.delivery ? { nextAttemptAt: item.delivery.nextAttemptAt } : {}),
      },
    });
  }
}
