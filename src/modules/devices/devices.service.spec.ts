import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { firstArg } from '../../common/testing/mock-arguments.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { DevicesService } from './devices.service.js';

const TOKEN = 'ExponentPushToken[abcdefghijklmnop]';
const FINGERPRINT = 'a'.repeat(24);

function build() {
  const tx = {
    device: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: 'device-1' }),
    },
  };
  const prisma = {
    device: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'device-1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const service = new DevicesService(
    prisma as unknown as PrismaService,
    {
      serializable: (operation: (client: typeof tx) => unknown) => operation(tx),
    } as unknown as TransactionService,
  );
  return { service, prisma, tx };
}

describe('DevicesService.register', () => {
  it('refuses a malformed push token before writing anything', async () => {
    const { service, tx } = build();
    await expect(
      service.register('user-1', { fingerprint: FINGERPRINT, pushToken: 'nope' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.device.upsert).not.toHaveBeenCalled();
  });

  it('refuses a fingerprint too short to identify an installation', async () => {
    const { service, tx } = build();
    await expect(service.register('user-1', { fingerprint: 'short' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(tx.device.upsert).not.toHaveBeenCalled();
  });

  it('releases the token from any other device claiming it', async () => {
    // A restored backup or a resold handset can hand the same token to a second
    // row; two rows holding one token would both look deliverable, and one
    // would send another person's notifications to this phone.
    const { service, tx } = build();
    await service.register('user-1', { fingerprint: FINGERPRINT, pushToken: TOKEN });
    const released = firstArg<{ where: { pushToken: string }; data: { pushToken: null } }>(
      tx.device.updateMany,
    );
    expect(released.where.pushToken).toBe(TOKEN);
    expect(released.data.pushToken).toBeNull();
  });

  it('does not release the token from the device registering it', async () => {
    const { service, tx } = build();
    await service.register('user-1', { fingerprint: FINGERPRINT, pushToken: TOKEN });
    const released = firstArg<{ where: { NOT: { userId: string; fingerprint: string } } }>(
      tx.device.updateMany,
    );
    expect(released.where.NOT).toEqual({ userId: 'user-1', fingerprint: FINGERPRINT });
  });

  it('registers a device with no token at all', async () => {
    // Declining permission must not stop the device being known: the record is
    // what a security review of the account reads.
    const { service, tx } = build();
    await service.register('user-1', {
      fingerprint: FINGERPRINT,
      pushPermissionDeclined: true,
    });
    expect(tx.device.updateMany).not.toHaveBeenCalled();
    const written = firstArg<{ create: { pushDeclinedAt: Date } }>(tx.device.upsert);
    expect(written.create.pushDeclinedAt).toBeInstanceOf(Date);
  });

  it('leaves a stored token alone when none is supplied', async () => {
    // A call made before permission resolves must not wipe a working token.
    const { service, tx } = build();
    await service.register('user-1', { fingerprint: FINGERPRINT });
    const written = firstArg<{ update: Record<string, unknown> }>(tx.device.upsert);
    expect(written.update).not.toHaveProperty('pushToken');
  });

  it('clears an earlier decline when permission is later granted', async () => {
    const { service, tx } = build();
    await service.register('user-1', { fingerprint: FINGERPRINT, pushToken: TOKEN });
    const written = firstArg<{ update: { pushDeclinedAt: Date | null } }>(tx.device.upsert);
    expect(written.update.pushDeclinedAt).toBeNull();
  });
});

describe('DevicesService', () => {
  it('never returns a push token in the device list', async () => {
    // The list is shown in the app; a token is an address for reaching the
    // device and has no business on a screen.
    const { service, prisma } = build();
    await service.list('user-1');
    const query = firstArg<{ select: Record<string, boolean> }>(prisma.device.findMany);
    expect(query.select.pushToken).toBe(false);
  });

  it('keeps the row when a device is deregistered', async () => {
    const { service, prisma } = build();
    await service.deregister('user-1', 'device-1');
    const update = firstArg<{ data: { pushToken: null } }>(prisma.device.update);
    expect(update.data.pushToken).toBeNull();
  });

  it('refuses to deregister a device belonging to someone else', async () => {
    const { service, prisma } = build();
    prisma.device.findFirst.mockResolvedValue(null);
    await expect(service.deregister('user-1', 'device-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.device.update).not.toHaveBeenCalled();
  });

  it('returns only tokens that exist', async () => {
    const { service, prisma } = build();
    prisma.device.findMany.mockResolvedValue([{ pushToken: TOKEN }, { pushToken: null }]);
    expect(await service.pushTokensFor('user-1')).toEqual([TOKEN]);
  });

  it('releases a token Expo says is dead', async () => {
    const { service, prisma } = build();
    await service.releaseUnregisteredToken(TOKEN);
    const cleared = firstArg<{ where: { pushToken: string } }>(prisma.device.updateMany);
    expect(cleared.where.pushToken).toBe(TOKEN);
  });
});
