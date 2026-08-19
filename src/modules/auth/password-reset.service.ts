import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, argon2id } from 'argon2';
import { randomInt, randomUUID } from 'node:crypto';
import {
  AccountVerificationChannel,
  SessionStatus,
  UserStatus,
  VerificationPurpose,
} from '../../../generated/prisma/enums.js';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { TransactionalNotificationService } from '../notifications/transactional-notification.service.js';
import {
  maskVerificationDestination,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  verificationCodeHash,
  verificationCodeMatches,
} from './domain/verification-policy.js';

export interface ResetChallengeResult {
  readonly challengeId: string;
  readonly destinationMasked: string;
  readonly expiresAt: string;
  readonly resendAvailableAt: string;
}

@Injectable()
export class PasswordResetService {
  private readonly tokenPepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly notifications: TransactionalNotificationService,
    config: ConfigService<Environment, true>,
  ) {
    this.tokenPepper = config.get('TOKEN_PEPPER', { infer: true });
  }

  /**
   * Always returns an identically shaped challenge whether or not the address
   * belongs to an account, so this endpoint cannot enumerate users. A decoy is
   * never delivered and can never be matched.
   */
  async requestReset(rawEmail: string): Promise<ResetChallengeResult> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    // Accounts without a usable password (e.g. Google-only) are treated exactly
    // like unknown addresses so neither case is distinguishable.
    const credential = user
      ? await this.prisma.userCredential.findUnique({ where: { userId: user.id } })
      : null;
    const eligible =
      user &&
      credential &&
      user.status !== UserStatus.SUSPENDED &&
      user.status !== UserStatus.DEACTIVATED;

    if (!eligible) return this.decoyChallenge(email);

    const existing = await this.prisma.accountVerificationChallenge.findFirst({
      where: this.openChallengeWhere(user.id),
      orderBy: { createdAt: 'desc' },
    });
    if (existing && existing.resendAvailableAt > new Date()) return this.describe(existing);

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

    // The code-based account-verification email is reused here: the
    // 'password-reset' template expects a reset URL, and this flow is code-based.
    await this.notifications.sendEmail({
      userId: user.id,
      destination: email,
      template: 'account-verification-email',
      variables: { code: challenge.code, expiresMinutes: '10' },
      storedPayload: { destination: challenge.destinationMasked, challengeId: challenge.id },
      dedupeKey: `password-reset:${challenge.id}`,
    });
    return this.describe(challenge.record);
  }

  /**
   * Verifies the code and sets the new password. Every existing session is
   * revoked: a reset is the remedy for a possibly compromised account, so any
   * session an attacker holds must not survive it.
   */
  async completeReset(challengeId: string, code: string, newPassword: string): Promise<void> {
    const passwordHash = await hash(newPassword, { type: argon2id });

    const outcome = await this.transactions.serializable(async (tx) => {
      const challenge = await tx.accountVerificationChallenge.findUnique({
        where: { id: challengeId },
      });
      if (
        !challenge ||
        challenge.purpose !== VerificationPurpose.PASSWORD_RESET ||
        challenge.consumedAt ||
        challenge.invalidatedAt
      ) {
        return 'invalid' as const;
      }
      if (challenge.expiresAt <= new Date()) return 'expired' as const;
      if (challenge.attemptCount >= challenge.maxAttempts) return 'locked' as const;

      if (!verificationCodeMatches(challenge.id, code, challenge.codeHash, this.tokenPepper)) {
        const attempts = challenge.attemptCount + 1;
        await tx.accountVerificationChallenge.update({
          where: { id: challenge.id },
          data: {
            attemptCount: attempts,
            ...(attempts >= challenge.maxAttempts ? { invalidatedAt: new Date() } : {}),
          },
        });
        return 'invalid' as const;
      }

      await tx.accountVerificationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      await tx.userCredential.upsert({
        where: { userId: challenge.userId },
        update: { passwordHash, changedAt: new Date() },
        create: { userId: challenge.userId, passwordHash },
      });
      // A reset also proves control of the mailbox, so verify a pending account.
      await tx.user.update({
        where: { id: challenge.userId },
        data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: challenge.userId, status: SessionStatus.ACTIVE },
        data: {
          status: SessionStatus.REVOKED,
          revokedAt: new Date(),
          revokeReason: 'password_reset',
        },
      });
      return 'ok' as const;
    });

    if (outcome === 'expired') throw new BadRequestException('This code has expired');
    if (outcome === 'locked')
      throw new BadRequestException('Too many attempts. Request a new code');
    if (outcome !== 'ok') throw new UnauthorizedException('Invalid or expired code');
  }

  private openChallengeWhere(userId: string) {
    return {
      userId,
      purpose: VerificationPurpose.PASSWORD_RESET,
      consumedAt: null,
      invalidatedAt: null,
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
        purpose: VerificationPurpose.PASSWORD_RESET,
        codeHash: verificationCodeHash(id, code, this.tokenPepper),
        destinationMasked,
        expiresAt,
        resendAvailableAt,
        maxAttempts: VERIFICATION_MAX_ATTEMPTS,
      },
    };
  }

  /** Shaped exactly like a real challenge, but backed by nothing. */
  private decoyChallenge(destination: string): ResetChallengeResult {
    const now = Date.now();
    return {
      challengeId: randomUUID(),
      destinationMasked: maskVerificationDestination(destination),
      expiresAt: new Date(now + VERIFICATION_CODE_TTL_MS).toISOString(),
      resendAvailableAt: new Date(now + VERIFICATION_RESEND_COOLDOWN_MS).toISOString(),
    };
  }

  private describe(challenge: {
    id: string;
    destinationMasked: string;
    expiresAt: Date;
    resendAvailableAt: Date;
  }): ResetChallengeResult {
    return {
      challengeId: challenge.id,
      destinationMasked: challenge.destinationMasked,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: challenge.resendAvailableAt.toISOString(),
    };
  }
}
