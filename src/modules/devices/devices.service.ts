import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { assertFingerprint, assertPushToken, describeDevice } from './domain/device-policy.js';
import type { RegisterDeviceDto } from './dto/register-device.dto.js';

const deviceSelect = {
  id: true,
  fingerprint: true,
  name: true,
  platform: true,
  appVersion: true,
  pushTokenAt: true,
  pushDeclinedAt: true,
  trustedAt: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

/**
 * The register of installations that may receive a push notification.
 *
 * A device row is per user and per installation, so signing in on a borrowed
 * phone does not silently attach that phone to the account's notifications
 * forever — the row is scoped to whoever registered it, and signing out clears
 * the token.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * Records this installation and, when supplied, its push token.
   *
   * Called at login rather than at first notification: a device that has not
   * announced itself cannot be reached, and finding that out at the moment
   * something important happens is too late.
   */
  async register(userId: string, dto: RegisterDeviceDto): Promise<unknown> {
    assertFingerprint(dto.fingerprint);
    if (dto.pushToken) assertPushToken(dto.pushToken);

    const device = await this.transactions.serializable(async (tx) => {
      // A push token identifies an installation, not a person. The same token
      // arriving under a different device or user means the app was restored or
      // the phone changed hands, so any older claim on it is released — two
      // rows holding one token would both look deliverable and one would be
      // sending another person's notifications to this handset.
      if (dto.pushToken) {
        await tx.device.updateMany({
          where: { pushToken: dto.pushToken, NOT: { userId, fingerprint: dto.fingerprint } },
          data: { pushToken: null, pushTokenAt: null },
        });
      }

      const now = new Date();
      return tx.device.upsert({
        where: { userId_fingerprint: { userId, fingerprint: dto.fingerprint } },
        create: {
          userId,
          fingerprint: dto.fingerprint,
          name: describeDevice(dto),
          ...(dto.platform ? { platform: dto.platform } : {}),
          ...(dto.appVersion ? { appVersion: dto.appVersion } : {}),
          ...(dto.pushToken ? { pushToken: dto.pushToken, pushTokenAt: now } : {}),
          ...(dto.pushPermissionDeclined ? { pushDeclinedAt: now } : {}),
          lastSeenAt: now,
        },
        update: {
          name: describeDevice(dto),
          ...(dto.platform ? { platform: dto.platform } : {}),
          ...(dto.appVersion ? { appVersion: dto.appVersion } : {}),
          // A supplied token replaces the stored one; omitting it leaves the
          // existing registration alone, so a call made before permission is
          // granted does not wipe a working token.
          ...(dto.pushToken ? { pushToken: dto.pushToken, pushTokenAt: now } : {}),
          // Granting permission clears an earlier decline, so the app stops
          // treating the user as someone who said no.
          ...(dto.pushToken
            ? { pushDeclinedAt: null }
            : dto.pushPermissionDeclined
              ? { pushDeclinedAt: now }
              : {}),
          lastSeenAt: now,
        },
        select: deviceSelect,
      });
    });
    return device;
  }

  /** This user's registered installations, for a "where you are signed in" view. */
  async list(userId: string): Promise<unknown> {
    return this.prisma.device.findMany({
      where: { userId },
      select: { ...deviceSelect, pushToken: false },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /**
   * Stops notifications reaching a device.
   *
   * The row is kept rather than deleted: it is the record that this
   * installation was once signed in, which matters for a security review of the
   * account. Only its ability to receive is removed.
   */
  async deregister(userId: string, deviceId: string): Promise<{ readonly deregistered: true }> {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('That device was not found');
    await this.prisma.device.update({
      where: { id: device.id },
      data: { pushToken: null, pushTokenAt: null },
    });
    return { deregistered: true };
  }

  /** Clears a token Expo has told us is dead, so nothing keeps sending to it. */
  async releaseUnregisteredToken(token: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: { pushToken: token },
      data: { pushToken: null, pushTokenAt: null },
    });
  }

  /** Every deliverable token for a user. A person may hold several devices. */
  async pushTokensFor(userId: string): Promise<string[]> {
    const devices = await this.prisma.device.findMany({
      where: { userId, pushToken: { not: null } },
      select: { pushToken: true },
    });
    return devices
      .map((device) => device.pushToken)
      .filter((token): token is string => token !== null);
  }
}
