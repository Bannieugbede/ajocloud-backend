import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID } from 'node:crypto';
import {
  AccountVerificationChannel,
  UserStatus,
  VerificationPurpose,
} from '../../../generated/prisma/enums.js';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { TransactionalNotificationService } from '../notifications/transactional-notification.service.js';
import { AuthService } from './auth.service.js';
import type { TokenPair } from './auth.service.js';
import {
  maskVerificationDestination,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  verificationCodeHash,
  verificationCodeMatches,
} from './domain/verification-policy.js';

/**
 * Permissions that qualify an account for the admin console. A passwordless
 * code is only ever delivered to users holding at least one of these, so the
 * flow cannot be used to sign ordinary members into /admin.
 */
const ADMIN_PERMISSIONS = ['audit.read', 'users.read'] as const;

interface ClientContext {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface OtpChallengeResult {
  readonly challengeId: string;
  readonly destinationMasked: string;
  readonly expiresAt: string;
  readonly resendAvailableAt: string;
}

@Injectable()
export class PasswordlessService {
  private readonly tokenPepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly notifications: TransactionalNotificationService,
    private readonly auth: AuthService,
    config: ConfigService<Environment, true>,
  ) {
    this.tokenPepper = config.get('TOKEN_PEPPER', { infer: true });
  }

  /**
   * Always returns a challenge shaped identically whether or not the email
   * belongs to an eligible admin, so the endpoint cannot be used to enumerate
   * accounts. A decoy challenge is simply never delivered and never matches.
   */
  async requestCode(rawEmail: string): Promise<OtpChallengeResult> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.findEligibleAdmin(email);

    if (!user) return this.decoyChallenge(email);

    const existing = await this.prisma.accountVerificationChallenge.findFirst({
      where: this.openChallengeWhere(user.id),
      orderBy: { createdAt: 'desc' },
    });
    if (existing && existing.resendAvailableAt > new Date()) {
      return this.describe(existing);
    }

    const challenge = this.newChallenge(email);
    await this.transactions.serializable(async (tx) => {
      await tx.accountVerificationChallenge.updateMany({
        where: this.openChallengeWhere(user.id),
        data: { invalidatedAt: new Date() },
      });
      await tx.accountVerificationChallenge.create({
        data: { ...challenge.data, userId: user.id },
      });
    });
    await this.deliver(user.id, email, challenge);
    return this.describe(challenge.record);
  }

  async resendCode(challengeId: string): Promise<OtpChallengeResult> {
    const current = await this.prisma.accountVerificationChallenge.findUnique({
      where: { id: challengeId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!current || current.purpose !== VerificationPurpose.LOGIN) {
      throw new UnauthorizedException('Sign-in request is no longer valid');
    }
    if (current.consumedAt) {
      throw new UnauthorizedException('Sign-in request is no longer valid');
    }
    if (current.resendAvailableAt > new Date()) {
      throw new HttpException(
        `Another code can be sent after ${current.resendAvailableAt.toISOString()}`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const email = current.user.email;
    if (!email) throw new UnauthorizedException('Sign-in request is no longer valid');

    const challenge = this.newChallenge(email);
    await this.transactions.serializable(async (tx) => {
      await tx.accountVerificationChallenge.updateMany({
        where: this.openChallengeWhere(current.user.id),
        data: { invalidatedAt: new Date() },
      });
      await tx.accountVerificationChallenge.create({
        data: { ...challenge.data, userId: current.user.id },
      });
    });
    await this.deliver(current.user.id, email, challenge);
    return this.describe(challenge.record);
  }

  async verifyCode(challengeId: string, code: string, context: ClientContext): Promise<TokenPair> {
    const userId = await this.transactions.serializable(async (tx) => {
      const challenge = await tx.accountVerificationChallenge.findUnique({
        where: { id: challengeId },
      });
      if (
        !challenge ||
        challenge.purpose !== VerificationPurpose.LOGIN ||
        challenge.consumedAt ||
        challenge.invalidatedAt
      ) {
        return { kind: 'invalid' } as const;
      }
      if (challenge.expiresAt <= new Date()) return { kind: 'expired' } as const;
      if (challenge.attemptCount >= challenge.maxAttempts) return { kind: 'locked' } as const;

      if (!verificationCodeMatches(challenge.id, code, challenge.codeHash, this.tokenPepper)) {
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

      await tx.accountVerificationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: challenge.userId },
        data: { lastLoginAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: challenge.userId,
          action: 'auth.passwordless_login',
          subjectType: 'User',
          subjectId: challenge.userId,
          ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        },
      });
      return { kind: 'verified', userId: challenge.userId } as const;
    });

    if (userId.kind === 'expired') {
      throw new UnauthorizedException('That code has expired — request a new one');
    }
    if (userId.kind === 'locked') {
      throw new HttpException('Too many incorrect codes', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (userId.kind === 'invalid') throw new UnauthorizedException('That code is not correct');

    // Re-check eligibility at redemption time: a role could have been revoked
    // between the code being sent and it being used.
    const stillEligible = await this.prisma.user.findFirst({
      where: { id: userId.userId, ...this.eligibilityWhere() },
      select: { id: true },
    });
    if (!stillEligible) throw new UnauthorizedException('This account cannot access the console');

    return this.auth.createPasswordlessSession(userId.userId, context);
  }

  private findEligibleAdmin(email: string) {
    return this.prisma.user.findFirst({
      where: { email, ...this.eligibilityWhere() },
      select: { id: true },
    });
  }

  private eligibilityWhere() {
    return {
      status: UserStatus.ACTIVE,
      roleAssignments: {
        some: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          role: {
            permissions: {
              some: { permission: { key: { in: [...ADMIN_PERMISSIONS] } } },
            },
          },
        },
      },
    };
  }

  private openChallengeWhere(userId: string) {
    return {
      userId,
      channel: AccountVerificationChannel.EMAIL,
      purpose: VerificationPurpose.LOGIN,
      consumedAt: null,
      invalidatedAt: null,
    };
  }

  private async deliver(
    userId: string,
    destination: string,
    challenge: ReturnType<PasswordlessService['newChallenge']>,
  ): Promise<void> {
    await this.notifications.sendEmail({
      userId,
      destination,
      template: 'sign-in-code',
      variables: {
        code: challenge.code,
        expiresMinutes: String(VERIFICATION_CODE_TTL_MS / 60_000),
      },
      storedPayload: { challengeId: challenge.id, destination: challenge.destinationMasked },
      dedupeKey: `sign-in-code:${challenge.id}`,
    });
  }

  /**
   * Unknown or ineligible emails still get a well-formed, correctly-timed
   * response. The id is random and matches no stored row, so verification
   * fails the same way a wrong code would.
   */
  private decoyChallenge(email: string): OtpChallengeResult {
    const now = Date.now();
    return {
      challengeId: randomUUID(),
      destinationMasked: maskVerificationDestination(email),
      expiresAt: new Date(now + VERIFICATION_CODE_TTL_MS).toISOString(),
      resendAvailableAt: new Date(now + VERIFICATION_RESEND_COOLDOWN_MS).toISOString(),
    };
  }

  private newChallenge(destination: string) {
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = Date.now();
    const expiresAt = new Date(now + VERIFICATION_CODE_TTL_MS);
    const resendAvailableAt = new Date(now + VERIFICATION_RESEND_COOLDOWN_MS);
    const destinationMasked = maskVerificationDestination(destination);
    return {
      id,
      code,
      destinationMasked,
      record: { id, destinationMasked, expiresAt, resendAvailableAt },
      data: {
        id,
        channel: AccountVerificationChannel.EMAIL,
        purpose: VerificationPurpose.LOGIN,
        codeHash: verificationCodeHash(id, code, this.tokenPepper),
        destinationMasked,
        expiresAt,
        resendAvailableAt,
        maxAttempts: VERIFICATION_MAX_ATTEMPTS,
      },
    } as const;
  }

  private describe(challenge: {
    id: string;
    destinationMasked: string;
    expiresAt: Date;
    resendAvailableAt: Date;
  }): OtpChallengeResult {
    return {
      challengeId: challenge.id,
      destinationMasked: challenge.destinationMasked,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: challenge.resendAvailableAt.toISOString(),
    };
  }
}
