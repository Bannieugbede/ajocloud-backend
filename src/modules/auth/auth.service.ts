import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify, argon2id } from 'argon2';
import { createHmac, randomBytes } from 'node:crypto';
import {
  AccountType,
  FinancialAccountPurpose,
  SessionStatus,
  UserStatus,
} from '../../../generated/prisma/enums.js';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

interface ClientContext {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: string;
}

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly accessTtl: string;
  private readonly tokenPepper: string;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly jwt: JwtService,
    config: ConfigService<Environment, true>,
  ) {
    this.accessSecret = config.get('JWT_ACCESS_SECRET', { infer: true });
    this.accessTtl = config.get('JWT_ACCESS_TTL', { infer: true });
    this.tokenPepper = config.get('TOKEN_PEPPER', { infer: true });
    this.refreshTtlSeconds = config.get('JWT_REFRESH_TTL_SECONDS', { infer: true });
  }

  async register(dto: RegisterDto, context: ClientContext): Promise<TokenPair> {
    const email = dto.email.trim().toLowerCase();
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
            status: UserStatus.ACTIVE,
            credential: { create: { passwordHash } },
            profile: { create: { firstName: dto.firstName.trim(), lastName: dto.lastName.trim() } },
            wallets: { create: { currency: 'NGN' } },
            roleAssignments: { create: { roleId: memberRole.id } },
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
            ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
          },
        });
        return created;
      });
      return this.createSession(user.id, context);
    } catch (error: unknown) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('An account with these details already exists');
      }
      throw error;
    }
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
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.revokeSessions({ id: sessionId }, 'user_logout');
  }

  async logoutAll(userId: string): Promise<void> {
    await this.revokeSessions({ userId }, 'user_logout_all');
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
