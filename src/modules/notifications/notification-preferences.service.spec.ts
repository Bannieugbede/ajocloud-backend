import { UnprocessableEntityException } from '@nestjs/common';
import { NotificationChannel } from '../../../generated/prisma/enums.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { NOTIFICATION_TOPICS } from './domain/notification-topics.js';
import { firstArg } from '../../common/testing/mock-arguments.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';

describe('NotificationPreferencesService', () => {
  const prisma = {
    notificationPreference: { findMany: jest.fn(), upsert: jest.fn() },
    userProfile: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const service = new NotificationPreferencesService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockResolvedValue([]);
  });

  describe('list', () => {
    it('returns the whole grid so the client never guesses a default', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      prisma.userProfile.findUnique.mockResolvedValue({ timezone: 'Africa/Lagos' });

      const result = await service.list('user-id');
      // Every topic, on each of the four settable channels.
      expect(result.preferences).toHaveLength(NOTIFICATION_TOPICS.length * 4);
      expect(result.preferences.every((entry) => entry.enabled)).toBe(true);
    });

    it('treats an absent preference as enabled, since preferences are opt-out', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      prisma.userProfile.findUnique.mockResolvedValue({ timezone: 'Africa/Lagos' });

      const result = await service.list('user-id');
      const payout = result.preferences.find(
        (entry) => entry.topic === 'ajo.payout' && entry.channel === NotificationChannel.EMAIL,
      );
      expect(payout?.enabled).toBe(true);
      expect(payout?.quietHoursStartMinutes).toBeNull();
    });

    it('overlays what the user actually chose', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([
        {
          topic: 'ajo.payout',
          channel: NotificationChannel.EMAIL,
          enabled: false,
          quietHoursStartMinutes: 22 * 60,
          quietHoursEndMinutes: 7 * 60,
          timezone: 'Africa/Lagos',
        },
      ]);
      prisma.userProfile.findUnique.mockResolvedValue({ timezone: 'Africa/Lagos' });

      const result = await service.list('user-id');
      const payout = result.preferences.find(
        (entry) => entry.topic === 'ajo.payout' && entry.channel === NotificationChannel.EMAIL,
      );
      expect(payout?.enabled).toBe(false);
      expect(payout?.quietHoursStartMinutes).toBe(22 * 60);
    });

    it('offers every channel the platform can address', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      prisma.userProfile.findUnique.mockResolvedValue({ timezone: 'Africa/Lagos' });

      const result = await service.list('user-id');
      const channels = new Set(result.preferences.map((entry) => entry.channel));
      expect(channels).toEqual(
        new Set([
          NotificationChannel.PUSH,
          NotificationChannel.IN_APP,
          NotificationChannel.EMAIL,
          NotificationChannel.SMS,
        ]),
      );
    });

    it('falls back to the platform timezone when the profile has none', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      prisma.userProfile.findUnique.mockResolvedValue(null);
      const result = await service.list('user-id');
      expect(result.timezone).toBe('Africa/Lagos');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      prisma.userProfile.findUnique.mockResolvedValue({ timezone: 'Africa/Lagos' });
    });

    it('refuses a half-configured quiet window', async () => {
      await expect(
        service.update('user-id', [
          {
            topic: 'ajo.payout',
            channel: NotificationChannel.EMAIL,
            enabled: true,
            quietHoursStartMinutes: 22 * 60,
          },
        ]),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts a push preference now that push delivers', async () => {
      await service.update('user-id', [
        { topic: 'ajo.payout', channel: NotificationChannel.PUSH, enabled: false },
      ]);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('validates every entry before writing any of them', async () => {
      await expect(
        service.update('user-id', [
          { topic: 'ajo.payout', channel: NotificationChannel.EMAIL, enabled: false },
          {
            topic: 'akawo.progress',
            channel: NotificationChannel.EMAIL,
            enabled: true,
            quietHoursEndMinutes: 60,
          },
        ]),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      // A partial save would leave the settings screen showing a state that was
      // never stored.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('writes the batch in one transaction and records the change', async () => {
      await service.update('user-id', [
        { topic: 'ajo.payout', channel: NotificationChannel.EMAIL, enabled: false },
      ]);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('records what changed without the message content it governs', async () => {
      await service.update('user-id', [
        { topic: 'ajo.payout', channel: NotificationChannel.EMAIL, enabled: false },
      ]);
      const audited = firstArg<{ data: { metadata: { changed: string[] } } }>(
        prisma.auditLog.create,
      );
      expect(audited.data.metadata.changed).toEqual(['EMAIL:ajo.payout']);
    });
  });
});
