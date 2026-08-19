import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleOAuthService } from './google-oauth.service.js';
import type { Environment } from '../../config/env.schema.js';

type Claims = Record<string, unknown>;

/** Shape of the user.create argument the linking path builds. */
interface CreatedUser {
  status: string;
  emailVerifiedAt: Date;
  profile: { create: { firstName: string; lastName: string } };
  credential?: unknown;
}

/** Reads the first user.create call in a typed way, keeping the spec lint-clean. */
function createdUser(create: jest.Mock): CreatedUser {
  const [call] = create.mock.calls as [[{ data: CreatedUser }]];
  return call[0].data;
}

/** Drives resolveUser directly: the network exchange is covered separately. */
function build(prisma: unknown) {
  const values: Record<string, unknown> = {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_CALLBACK_URL: 'https://api.example.test/cb',
    TOKEN_PEPPER: 'pepper-value-at-least-32-characters-long',
  };
  const auth = { createSessionForUser: jest.fn().mockResolvedValue({ accessToken: 'a' }) };
  const service = new GoogleOAuthService(
    prisma as never,
    auth as never,
    {
      get: (key: string) => values[key],
    } as unknown as ConfigService<Environment, true>,
  );
  const resolve = (claims: Claims) =>
    (
      service as unknown as {
        resolveUser(c: Claims, ctx: Record<string, unknown>): Promise<unknown>;
      }
    ).resolveUser(claims, {});
  return { resolve, auth };
}

const VERIFIED = { sub: 'google-123', email: 'Member@Example.test', email_verified: true };

describe('Google identity linking', () => {
  it('refuses an unverified Google email', async () => {
    const { resolve, auth } = build({});
    await expect(resolve({ ...VERIFIED, email_verified: false })).rejects.toThrow(
      BadRequestException,
    );
    // Nothing may be created for an address Google has not verified.
    expect(auth.createSessionForUser).not.toHaveBeenCalled();
  });

  it('refuses a claim with no email at all', async () => {
    const { resolve } = build({});
    await expect(resolve({ sub: 'google-123', email_verified: true })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('signs in a returning identity by provider subject', async () => {
    const prisma = {
      userIdentity: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'identity-1',
          userId: 'user-1',
          user: { status: 'ACTIVE' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const { resolve, auth } = build(prisma);
    await resolve(VERIFIED);
    expect(auth.createSessionForUser).toHaveBeenCalledWith('user-1', {});
  });

  it('blocks a returning identity whose user is no longer active', async () => {
    const prisma = {
      userIdentity: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'identity-1',
          userId: 'user-1',
          user: { status: 'SUSPENDED' },
        }),
        update: jest.fn(),
      },
    };
    const { resolve, auth } = build(prisma);
    await expect(resolve(VERIFIED)).rejects.toThrow(BadRequestException);
    expect(auth.createSessionForUser).not.toHaveBeenCalled();
  });

  it('links a verified Google identity to an existing password account', async () => {
    const prisma = {
      userIdentity: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-9',
          status: 'PENDING_VERIFICATION',
          emailVerifiedAt: null,
        }),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const { resolve, auth } = build(prisma);
    await resolve(VERIFIED);

    // Email is normalised before lookup so casing cannot fork an account.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'member@example.test' },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(auth.createSessionForUser).toHaveBeenCalledWith('user-9', {});
  });

  it('refuses to link into a suspended account', async () => {
    const prisma = {
      userIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-9', status: 'SUSPENDED' }) },
      $transaction: jest.fn(),
    };
    const { resolve, auth } = build(prisma);
    await expect(resolve(VERIFIED)).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.createSessionForUser).not.toHaveBeenCalled();
  });

  it('creates an active, already-verified account for a new Google user', async () => {
    const prisma = {
      userIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-new' }),
      },
    };
    const { resolve, auth } = build(prisma);
    await resolve({ ...VERIFIED, given_name: 'Ada', family_name: 'Obi' });

    const data = createdUser(prisma.user.create);
    expect(data.status).toBe('ACTIVE');
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data.profile.create).toEqual({ firstName: 'Ada', lastName: 'Obi' });
    // Google accounts have no password, so no credential row is written.
    expect(data.credential).toBeUndefined();
    expect(auth.createSessionForUser).toHaveBeenCalledWith('user-new', {});
  });

  it('derives a name when Google sends only a full name', async () => {
    const prisma = {
      userIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-new' }),
      },
    };
    const { resolve } = build(prisma);
    await resolve({ ...VERIFIED, name: 'Ada Grace Obi' });
    expect(createdUser(prisma.user.create).profile.create).toEqual({
      firstName: 'Ada',
      lastName: 'Grace Obi',
    });
  });
});
