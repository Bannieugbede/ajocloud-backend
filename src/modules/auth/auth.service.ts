import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify, argon2id } from 'argon2';
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  AccountType,
  AccountVerificationChannel,
  ConsentType,
  FinancialAccountPurpose,
  SessionStatus,
  UserStatus,
} from '../../../generated/prisma/enums.js';
import type { Environment } from '../../config/env.schema.js';
import type { AccountVerificationChallenge } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { TransactionalNotificationService } from '../notifications/transactional-notification.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import {
  maskVerificationDestination,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  verificationCodeHash,
  verificationCodeMatches,
} from './domain/verification-policy.js';
import { VerificationDeliveryService } from './verification-delivery.service.js';

/**
 * Version of the privacy policy a new account consents to. Bump this when the
 * policy changes so existing consents stay attributable to the text accepted.
 */
const PRIVACY_POLICY_VERSION = '2026-07-16';

interface ClientContext {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: string;
  readonly accessTokenExpiresAt: string;
}

export interface VerificationChallengeResult {
  readonly userId: string;
  readonly channel: AccountVerificationChannel;
  readonly destinationMasked: string;
  readonly expiresAt: string;
  readonly resendAvailableAt: string;
  readonly deliveryStatus: 'SENT' | 'FAILED';
}

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly accessTtl: string;
  private readonly tokenPepper: string;
  private readonly refreshTtlSeconds: number;
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly jwt: JwtService,
    private readonly verificationDelivery: VerificationDeliveryService,
    private readonly notifications: TransactionalNotificationService,
    config: ConfigService<Environment, true>,
  ) {
    this.accessSecret = config.get('JWT_ACCESS_SECRET', { infer: true });
    this.accessTtl = config.get('JWT_ACCESS_TTL', { infer: true });
    this.accessTtlSeconds = parseDurationSeconds(this.accessTtl);
    this.tokenPepper = config.get('TOKEN_PEPPER', { infer: true });
    this.refreshTtlSeconds = config.get('JWT_REFRESH_TTL_SECONDS', { infer: true });
  }

  async register(dto: RegisterDto, context: ClientContext): Promise<VerificationChallengeResult> {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone.trim();
    const referralCode = dto.referralCode?.trim().toUpperCase();
    const challenge = this.newChallenge(email);
    const passwordHash = await hash(dto.password, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
    try {
      const user = await this.transactions.serializable(async (tx) => {
        const memberRole = await tx.role.upsert({
          where: { name: 'MEMBER' },
          update: {},
          create: { name: 'MEMBER', isSystem: true },
        });
        const created = await tx.user.create({
          data: {
            email,
            phone,
            status: UserStatus.PENDING_VERIFICATION,
            credential: { create: { passwordHash } },
            profile: { create: { firstName: dto.firstName.trim(), lastName: dto.lastName.trim() } },
            wallets: { create: { currency: 'NGN' } },
            roleAssignments: { create: { roleId: memberRole.id } },
            consents: {
              create: [
                {
                  type: ConsentType.PRIVACY,
                  version: PRIVACY_POLICY_VERSION,
                  ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
                },
              ],
            },
            verificationChallenges: { create: challenge.data },
          },
        });
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId: created.id, currency: 'NGN' } },
        });
        await tx.financialAccount.createMany({
          data: [
            {
              code: `WALLET:${wallet.id}:AVAILABLE`,
              name: 'Wallet available balance',
              type: AccountType.LIABILITY,
              purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
              currency: wallet.currency,
              walletId: wallet.id,
            },
            {
              code: `WALLET:${wallet.id}:RESERVED`,
              name: 'Wallet reserved balance',
              type: AccountType.LIABILITY,
              purpose: FinancialAccountPurpose.WALLET_RESERVED,
              currency: wallet.currency,
              walletId: wallet.id,
            },
          ],
        });
        await tx.auditLog.create({
          data: {
            actorUserId: created.id,
            action: 'auth.registered',
            subjectType: 'User',
            subjectId: created.id,
            // The code itself is not sensitive, but it is only recorded when
            // one was supplied so the log stays a faithful record of intent.
            ...(referralCode ? { metadata: { referralCode } } : {}),
            ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
          },
        });
        return created;
      });
      const deliveryStatus = await this.deliverChallenge({
        userId: user.id,
        destination: email,
        challenge,
      });
      return this.challengeResponse(user.id, challenge, deliveryStatus);
    } catch (error: unknown) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('An account with these details already exists');
      }
      throw error;
    }
  }

  async verifyEmail(userId: string, code: string, context: ClientContext): Promise<TokenPair> {
    const result = await this.transactions.serializable(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      });
      if (!user?.email) return { kind: 'missing' } as const;
      if (user.emailVerifiedAt && user.status === UserStatus.ACTIVE)
        return { kind: 'already' } as const;
      const challenge = await tx.accountVerificationChallenge.findFirst({
        where: {
          userId,
          channel: AccountVerificationChannel.EMAIL,
          consumedAt: null,
          invalidatedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!challenge) return { kind: 'expired' } as const;
      const validation = this.validateChallenge(challenge, code);
      if (validation === 'invalid') {
        const attempts = challenge.attemptCount + 1;
        await tx.accountVerificationChallenge.update({
          where: { id: challenge.id },
          data: {
            attemptCount: attempts,
            ...(attempts >= challenge.maxAttempts ? { invalidatedAt: new Date() } : {}),
          },
        });
        return { kind: 'invalid' } as const;
      }
      if (validation === 'expired') return { kind: 'expired' } as const;
      if (validation === 'locked') return { kind: 'locked' } as const;
      await tx.accountVerificationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'auth.account_verified',
          subjectType: 'User',
          subjectId: userId,
        },
      });
      return {
        kind: 'verified',
        email: user.email,
        firstName: user.profile?.firstName ?? 'there',
      } as const;
    });
    if (result.kind === 'missing') throw new NotFoundException('Verification request not found');
    if (result.kind === 'already') throw new ConflictException('Email is already verified');
    if (result.kind === 'expired') throw new BadRequestException('Verification code has expired');
    if (result.kind === 'locked')
      throw new HttpException('Verification attempts exceeded', HttpStatus.TOO_MANY_REQUESTS);
    if (result.kind === 'invalid') throw new UnauthorizedException('Verification code is invalid');
    const tokens = await this.createSession(userId, context);
    await this.notifications.sendEmail({
      userId,
      destination: result.email,
      template: 'welcome',
      variables: { firstName: result.firstName },
      storedPayload: { event: 'account-verified' },
      dedupeKey: `welcome:${userId}`,
    });
    return tokens;
  }

  async resendVerification(userId: string): Promise<VerificationChallengeResult> {
    const result = await this.transactions.serializable(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      const destination = user?.email;
      if (!user || !destination || user.emailVerifiedAt) return { kind: 'missing' } as const;
      const latest = await tx.accountVerificationChallenge.findFirst({
        where: {
          userId,
          channel: AccountVerificationChannel.EMAIL,
          consumedAt: null,
          invalidatedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && latest.resendAvailableAt > new Date())
        return { kind: 'cooldown', retryAt: latest.resendAvailableAt } as const;
      const challenge = this.newChallenge(destination);
      await tx.accountVerificationChallenge.updateMany({
        where: {
          userId,
          channel: AccountVerificationChannel.EMAIL,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: new Date() },
      });
      await tx.accountVerificationChallenge.create({ data: { ...challenge.data, userId } });
      return { kind: 'created', destination, challenge } as const;
    });
    if (result.kind === 'missing') throw new NotFoundException('Verification request not found');
    if (result.kind === 'cooldown') {
      throw new HttpException(
        `Try again after ${result.retryAt.toISOString()}`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const deliveryStatus = await this.deliverChallenge({
      userId,
      destination: result.destination,
      challenge: result.challenge,
    });
    return this.challengeResponse(userId, result.challenge, deliveryStatus);
  }

  async login(dto: LoginDto, context: ClientContext): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { credential: true },
    });
    const valid = user?.credential
      ? await verify(user.credential.passwordHash, dto.password)
      : false;
    if (!user || !valid || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.createSession(user.id, context);
  }

  async refresh(rawToken: string): Promise<TokenPair> {
    const tokenHash = this.digest(rawToken);
    const result = await this.transactions.serializable(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { session: true },
      });
      if (!token || token.revokedAt || token.expiresAt <= new Date())
        return { kind: 'invalid' } as const;
      if (token.consumedAt || token.session.currentTokenHash !== tokenHash) {
        await tx.session.update({
          where: { id: token.sessionId },
          data: {
            status: SessionStatus.COMPROMISED,
            revokedAt: new Date(),
            revokeReason: 'refresh_token_reuse',
          },
        });
        await tx.refreshToken.updateMany({
          where: { sessionId: token.sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { kind: 'compromised' } as const;
      }
      if (token.session.status !== SessionStatus.ACTIVE || token.session.expiresAt <= new Date())
        return { kind: 'invalid' } as const;
      const nextRaw = randomBytes(48).toString('base64url');
      const nextHash = this.digest(nextRaw);
      const nextExpiry = new Date(Date.now() + this.refreshTtlSeconds * 1_000);
      const replacement = await tx.refreshToken.create({
        data: { sessionId: token.sessionId, tokenHash: nextHash, expiresAt: nextExpiry },
      });
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date(), replacedById: replacement.id },
      });
      await tx.session.update({
        where: { id: token.sessionId },
        data: { currentTokenHash: nextHash, lastRotatedAt: new Date(), expiresAt: nextExpiry },
      });
      return {
        kind: 'rotated',
        rawToken: nextRaw,
        userId: token.session.userId,
        sessionId: token.sessionId,
      } as const;
    });
    if (result.kind !== 'rotated') throw new UnauthorizedException('Refresh token is invalid');
    return {
      accessToken: await this.signAccessToken(result.userId, result.sessionId),
      refreshToken: result.rawToken,
      expiresIn: this.accessTtl,
      accessTokenExpiresAt: new Date(Date.now() + this.accessTtlSeconds * 1_000).toISOString(),
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.revokeSessions({ id: sessionId }, 'user_logout');
  }

  async logoutAll(userId: string): Promise<void> {
    await this.revokeSessions({ userId }, 'user_logout_all');
  }

  /**
   * Issues a session for a user whose identity has already been established by
   * another factor (e.g. a redeemed one-time sign-in code).
   */
  createPasswordlessSession(userId: string, context: ClientContext): Promise<TokenPair> {
    return this.createSession(userId, context);
  }

  /**
   * Issues a session for an already-authenticated user. Federated sign-in has
   * verified the identity by another route, so no credential check happens here.
   */
  async createSessionForUser(userId: string, context: ClientContext): Promise<TokenPair> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return this.createSession(userId, context);
  }

  private async createSession(userId: string, context: ClientContext): Promise<TokenPair> {
    const rawToken = randomBytes(48).toString('base64url');
    const tokenHash = this.digest(rawToken);
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1_000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        currentTokenHash: tokenHash,
        expiresAt,
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 500) } : {}),
        refreshTokens: { create: { tokenHash, expiresAt } },
      },
    });
    return {
      accessToken: await this.signAccessToken(userId, session.id),
      refreshToken: rawToken,
      expiresIn: this.accessTtl,
      accessTokenExpiresAt: new Date(Date.now() + this.accessTtlSeconds * 1_000).toISOString(),
    };
  }

  private newChallenge(destination: string) {
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = Date.now();
    const expiresAt = new Date(now + VERIFICATION_CODE_TTL_MS);
    const resendAvailableAt = new Date(now + VERIFICATION_RESEND_COOLDOWN_MS);
    return {
      id,
      code,
      destinationMasked: maskVerificationDestination(destination),
      expiresAt,
      resendAvailableAt,
      data: {
        id,
        channel: AccountVerificationChannel.EMAIL,
        codeHash: verificationCodeHash(id, code, this.tokenPepper),
        destinationMasked: maskVerificationDestination(destination),
        expiresAt,
        resendAvailableAt,
        maxAttempts: VERIFICATION_MAX_ATTEMPTS,
      },
    } as const;
  }

  private validateChallenge(
    challenge: AccountVerificationChallenge | null,
    code: string,
  ): 'valid' | 'invalid' | 'expired' | 'locked' {
    if (!challenge || challenge.expiresAt <= new Date()) return 'expired';
    if (challenge.attemptCount >= challenge.maxAttempts) return 'locked';
    return verificationCodeMatches(challenge.id, code, challenge.codeHash, this.tokenPepper)
      ? 'valid'
      : 'invalid';
  }

  private async deliverChallenge(input: {
    userId: string;
    destination: string;
    challenge: ReturnType<AuthService['newChallenge']>;
  }): Promise<'SENT' | 'FAILED'> {
    try {
      await this.verificationDelivery.send({
        userId: input.userId,
        challengeId: input.challenge.id,
        destination: input.destination,
        destinationMasked: input.challenge.destinationMasked,
        code: input.challenge.code,
      });
      return 'SENT';
    } catch {
      return 'FAILED';
    }
  }

  private challengeResponse(
    userId: string,
    challenge: ReturnType<AuthService['newChallenge']>,
    deliveryStatus: 'SENT' | 'FAILED',
  ): VerificationChallengeResult {
    return {
      userId,
      channel: challenge.data.channel,
      destinationMasked: challenge.destinationMasked,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: challenge.resendAvailableAt.toISOString(),
      deliveryStatus,
    };
  }

  private signAccessToken(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId, typ: 'access' },
      { secret: this.accessSecret, expiresIn: this.accessTtl as never },
    );
  }

  private digest(rawToken: string): string {
    return createHmac('sha256', this.tokenPepper).update(rawToken).digest('hex');
  }

  private async revokeSessions(
    where: { id?: string; userId?: string },
    reason: string,
  ): Promise<void> {
    await this.transactions.serializable(async (tx) => {
      const sessions = await tx.session.findMany({
        where: { ...where, status: SessionStatus.ACTIVE },
        select: { id: true },
      });
      const ids = sessions.map((session) => session.id);
      if (ids.length === 0) return;
      await tx.session.updateMany({
        where: { id: { in: ids } },
        data: { status: SessionStatus.REVOKED, revokedAt: new Date(), revokeReason: reason },
      });
      await tx.refreshToken.updateMany({
        where: { sessionId: { in: ids }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}

function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error('JWT access TTL is invalid');
  const amount = Number(match[1]);
  const multiplier = { s: 1, m: 60, h: 3_600, d: 86_400 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return amount * multiplier;
}
