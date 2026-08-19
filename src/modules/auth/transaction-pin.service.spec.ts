import { BadRequestException, HttpException } from '@nestjs/common';
import { hash, argon2id } from 'argon2';
import { TransactionPinService } from './transaction-pin.service.js';
import { TRANSACTION_PIN_MAX_ATTEMPTS } from './domain/transaction-pin-policy.js';

interface PinRow {
  userId: string;
  pinHash: string;
  failedCount: number;
  lockedUntil: Date | null;
}

/** Reads the update payload of a mocked Prisma call in a typed way. */
function updateData<T>(mock: jest.Mock): T {
  const [call] = mock.mock.calls as [[{ data: T }]];
  return call[0].data;
}

function build(row: PinRow | null) {
  const prisma = {
    transactionPin: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockResolvedValue(row),
    },
  };
  return { service: new TransactionPinService(prisma as never), prisma };
}

async function pinRow(pin: string, overrides: Partial<PinRow> = {}): Promise<PinRow> {
  return {
    userId: 'user-1',
    pinHash: await hash(pin, { type: argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 }),
    failedCount: 0,
    lockedUntil: null,
    ...overrides,
  };
}

describe('TransactionPinService', () => {
  describe('status', () => {
    it('reports no PIN when none is set', async () => {
      const { service } = build(null);
      await expect(service.status('user-1')).resolves.toEqual({ isSet: false, lockedUntil: null });
    });

    it('reports a PIN without a lock when the lock has passed', async () => {
      const row = await pinRow('1357', { lockedUntil: new Date(Date.now() - 1_000) });
      const { service } = build(row);
      await expect(service.status('user-1')).resolves.toEqual({ isSet: true, lockedUntil: null });
    });

    it('surfaces an active lock so the app can show when to retry', async () => {
      const lockedUntil = new Date(Date.now() + 60_000);
      const { service } = build(await pinRow('1357', { lockedUntil }));
      await expect(service.status('user-1')).resolves.toEqual({
        isSet: true,
        lockedUntil: lockedUntil.toISOString(),
      });
    });
  });

  describe('setPin', () => {
    it('stores only an argon2id digest, never the PIN', async () => {
      const { service, prisma } = build(null);
      await service.setPin('user-1', '1357');

      const [call] = prisma.transactionPin.upsert.mock.calls as [[{ create: { pinHash: string } }]];
      expect(call[0].create.pinHash).toMatch(/^\$argon2id\$/);
      // The PIN itself must appear nowhere in what is handed to the database.
      expect(JSON.stringify(call[0])).not.toContain('1357');
    });

    it('refuses a predictable PIN', async () => {
      const { service } = build(null);
      await expect(service.setPin('user-1', '1234')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setPin('user-1', '0000')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a PIN that is not four digits', async () => {
      const { service } = build(null);
      await expect(service.setPin('user-1', '135')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires the current PIN when one already exists', async () => {
      const { service } = build(await pinRow('1357'));
      await expect(service.setPin('user-1', '2846')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('replaces the PIN when the current one is proved', async () => {
      const { service, prisma } = build(await pinRow('1357'));
      await expect(service.setPin('user-1', '2846', '1357')).resolves.toEqual({
        isSet: true,
        lockedUntil: null,
      });
      expect(prisma.transactionPin.upsert).toHaveBeenCalled();
    });

    it('rejects a replacement when the current PIN is wrong', async () => {
      const { service, prisma } = build(await pinRow('1357'));
      await expect(service.setPin('user-1', '2846', '9999')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.transactionPin.upsert).not.toHaveBeenCalled();
    });
  });

  describe('verifyPin', () => {
    it('accepts the correct PIN', async () => {
      const { service } = build(await pinRow('1357'));
      await expect(service.verifyPin('user-1', '1357')).resolves.toBeUndefined();
    });

    it('clears a stale failure count on success', async () => {
      const { service, prisma } = build(await pinRow('1357', { failedCount: 2 }));
      await service.verifyPin('user-1', '1357');
      expect(updateData<{ failedCount: number }>(prisma.transactionPin.update)).toEqual(
        expect.objectContaining({ failedCount: 0, lockedUntil: null }),
      );
    });

    it('counts a wrong PIN without locking below the limit', async () => {
      const { service, prisma } = build(await pinRow('1357'));
      await expect(service.verifyPin('user-1', '9999')).rejects.toBeInstanceOf(BadRequestException);
      expect(updateData<{ failedCount: number }>(prisma.transactionPin.update)).toEqual(
        expect.objectContaining({ failedCount: 1, lockedUntil: null }),
      );
    });

    it('locks after the final wrong attempt', async () => {
      const { service, prisma } = build(
        await pinRow('1357', { failedCount: TRANSACTION_PIN_MAX_ATTEMPTS - 1 }),
      );
      await expect(service.verifyPin('user-1', '9999')).rejects.toBeInstanceOf(HttpException);
      const data = updateData<{ lockedUntil: Date | null }>(prisma.transactionPin.update);
      expect(data.lockedUntil).toBeInstanceOf(Date);
    });

    it('refuses while locked, without spending an attempt', async () => {
      const { service, prisma } = build(
        await pinRow('1357', { lockedUntil: new Date(Date.now() + 60_000) }),
      );
      // Even the correct PIN is refused: the lock is the whole point.
      await expect(service.verifyPin('user-1', '1357')).rejects.toBeInstanceOf(HttpException);
      expect(prisma.transactionPin.update).not.toHaveBeenCalled();
    });

    it('fails when no PIN has been set', async () => {
      const { service } = build(null);
      await expect(service.verifyPin('user-1', '1357')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
