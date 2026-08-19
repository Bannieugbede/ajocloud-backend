import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PasswordResetService } from './password-reset.service.js';
import type { Environment } from '../../config/env.schema.js';
import { verificationCodeHash } from './domain/verification-policy.js';

const PEPPER = 'pepper-value-at-least-32-characters-long';

interface Challenge {
  id: string;
  userId: string;
  purpose: string;
  codeHash: string;
  expiresAt: Date;
  attemptCount: number;
  maxAttempts: number;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
}

/** Reads the first argument of a mocked Prisma call in a typed way. */
function firstArg<T>(mock: jest.Mock): T {
  const [call] = mock.mock.calls as [[T]];
  return call[0];
}

function build<T extends object>(prisma: T, notifications = { sendEmail: jest.fn() }) {
  const transactions = {
    serializable: (fn: (tx: unknown) => unknown) => Promise.resolve(fn(prisma)),
  };
  const config = {
    get: () => PEPPER,
  } as unknown as ConfigService<Environment, true>;
  const service = new PasswordResetService(
    prisma as never,
    transactions as never,
    notifications as never,
    config,
  );
  return { service, notifications };
}

describe('PasswordResetService', () => {
  describe('requestReset', () => {
    it('returns a decoy for an unknown address without sending mail', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        userCredential: { findUnique: jest.fn() },
        accountVerificationChallenge: { findFirst: jest.fn() },
      };
      const { service, notifications } = build(prisma);
      const result = await service.requestReset('nobody@example.test');

      // Shaped like a real challenge so responses are indistinguishable.
      expect(result.challengeId).toBeTruthy();
      expect(result.destinationMasked).toContain('@');
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('returns a decoy for an account with no password, e.g. Google-only', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'ACTIVE' }) },
        userCredential: { findUnique: jest.fn().mockResolvedValue(null) },
        accountVerificationChallenge: { findFirst: jest.fn() },
      };
      const { service, notifications } = build(prisma);
      await expect(service.requestReset('google@example.test')).resolves.toBeTruthy();
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('returns a decoy for a suspended account', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'SUSPENDED' }) },
        userCredential: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1' }) },
        accountVerificationChallenge: { findFirst: jest.fn() },
      };
      const { service, notifications } = build(prisma);
      await expect(service.requestReset('suspended@example.test')).resolves.toBeTruthy();
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('issues and delivers a challenge for an eligible account', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'ACTIVE' }) },
        userCredential: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1' }) },
        accountVerificationChallenge: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
          create: jest.fn(),
        },
      };
      const { service, notifications } = build(prisma);
      await service.requestReset('Member@Example.test');

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'member@example.test' } }),
      );
      expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
      // The plaintext code must never be persisted on the challenge.
      const created = firstArg<{ data: Record<string, unknown> }>(
        prisma.accountVerificationChallenge.create,
      );
      expect(created.data.codeHash).toEqual(expect.any(String));
      expect(created.data).not.toHaveProperty('code');
    });

    it('respects the resend cooldown instead of sending again', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'ACTIVE' }) },
        userCredential: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1' }) },
        accountVerificationChallenge: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'existing',
            destinationMasked: 'me•••@example.test',
            expiresAt: new Date(Date.now() + 60_000),
            resendAvailableAt: new Date(Date.now() + 30_000),
          }),
        },
      };
      const { service, notifications } = build(prisma);
      await expect(service.requestReset('member@example.test')).resolves.toMatchObject({
        challengeId: 'existing',
      });
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('completeReset', () => {
    const challenge = (overrides: Partial<Challenge> = {}): Challenge => ({
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'u1',
      purpose: 'PASSWORD_RESET',
      codeHash: verificationCodeHash('11111111-1111-4111-8111-111111111111', '123456', PEPPER),
      expiresAt: new Date(Date.now() + 60_000),
      attemptCount: 0,
      maxAttempts: 5,
      consumedAt: null,
      invalidatedAt: null,
      ...overrides,
    });

    interface ResetPrisma {
      accountVerificationChallenge: { findUnique: jest.Mock; update: jest.Mock };
      userCredential: { upsert: jest.Mock };
      user: { update: jest.Mock };
      session: { updateMany: jest.Mock };
    }

    const prismaFor = (found: Challenge | null): ResetPrisma => ({
      accountVerificationChallenge: {
        findUnique: jest.fn().mockResolvedValue(found),
        update: jest.fn(),
      },
      userCredential: { upsert: jest.fn() },
      user: { update: jest.fn() },
      session: { updateMany: jest.fn() },
    });

    it('sets the new password and revokes every existing session', async () => {
      const prisma = prismaFor(challenge());
      const { service } = build(prisma);
      await service.completeReset(challenge().id, '123456', 'a-brand-new-password');

      expect(prisma.userCredential.upsert).toHaveBeenCalled();
      // A reset is the remedy for compromise, so no session may survive it.
      const revoked = firstArg<{ data: { revokeReason: string } }>(prisma.session.updateMany);
      expect(revoked.data.revokeReason).toBe('password_reset');
      // The stored hash must never be the plaintext password.
      const upserted = firstArg<{ update: { passwordHash: string } }>(prisma.userCredential.upsert);
      expect(upserted.update.passwordHash).not.toContain('a-brand-new-password');
      expect(upserted.update.passwordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('rejects a wrong code and counts the attempt', async () => {
      const prisma = prismaFor(challenge());
      const { service } = build(prisma);
      await expect(
        service.completeReset(challenge().id, '000000', 'a-brand-new-password'),
      ).rejects.toThrow(UnauthorizedException);
      const attempted = firstArg<{ data: { attemptCount: number } }>(
        prisma.accountVerificationChallenge.update,
      );
      expect(attempted.data.attemptCount).toBe(1);
      expect(prisma.userCredential.upsert).not.toHaveBeenCalled();
    });

    it('invalidates the challenge once attempts are exhausted', async () => {
      const prisma = prismaFor(challenge({ attemptCount: 4 }));
      const { service } = build(prisma);
      await expect(
        service.completeReset(challenge().id, '000000', 'a-brand-new-password'),
      ).rejects.toThrow(UnauthorizedException);
      const locked = firstArg<{ data: { invalidatedAt: Date } }>(
        prisma.accountVerificationChallenge.update,
      );
      expect(locked.data.invalidatedAt).toBeInstanceOf(Date);
    });

    it('refuses an expired challenge', async () => {
      const prisma = prismaFor(challenge({ expiresAt: new Date(Date.now() - 1) }));
      const { service } = build(prisma);
      await expect(
        service.completeReset(challenge().id, '123456', 'a-brand-new-password'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.userCredential.upsert).not.toHaveBeenCalled();
    });

    it('refuses a locked challenge', async () => {
      const prisma = prismaFor(challenge({ attemptCount: 5 }));
      const { service } = build(prisma);
      await expect(
        service.completeReset(challenge().id, '123456', 'a-brand-new-password'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a consumed challenge, so a code cannot be replayed', async () => {
      const prisma = prismaFor(challenge({ consumedAt: new Date() }));
      const { service } = build(prisma);
      await expect(
        service.completeReset(challenge().id, '123456', 'a-brand-new-password'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.userCredential.upsert).not.toHaveBeenCalled();
    });

    it('refuses a challenge issued for a different purpose', async () => {
      const prisma = prismaFor(challenge({ purpose: 'LOGIN' }));
      const { service } = build(prisma);
      await expect(
        service.completeReset(challenge().id, '123456', 'a-brand-new-password'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.userCredential.upsert).not.toHaveBeenCalled();
    });
  });
});
