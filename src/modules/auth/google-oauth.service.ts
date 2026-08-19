import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IdentityProvider, UserStatus } from '../../../generated/prisma/enums.js';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuthService, type TokenPair } from './auth.service.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/**
 * Google validates the ID token's signature and expiry for us here. This avoids
 * adding a JWKS client dependency, and the call is already part of a trusted,
 * TLS-authenticated exchange with Google. The audience and issuer are still
 * checked locally below, because tokeninfo will happily describe a token that
 * was minted for a different client.
 */
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
/** How long a started sign-in may remain unfinished. */
const STATE_TTL_MS = 10 * 60 * 1000;
/**
 * A mobile handoff code is redeemed immediately by the app, so it lives only
 * long enough to survive the deep link.
 */
const HANDOFF_TTL_MS = 2 * 60 * 1000;

export type OAuthClient = 'web' | 'mobile';

interface GoogleClaims {
  readonly sub: string;
  readonly email?: string;
  readonly email_verified?: boolean | string;
  readonly given_name?: string;
  readonly family_name?: string;
  readonly name?: string;
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  /**
   * One-time handoff codes for the mobile deep link. Native clients keep tokens
   * in SecureStore rather than cookies, and a deep-link URL can be logged by the
   * OS, so the link carries only this code and the app exchanges it over TLS.
   * In-memory is sufficient: a code is redeemed seconds after issue, and losing
   * it on restart only means signing in again.
   */
  private readonly handoffs = new Map<string, { tokens: TokenPair; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  /** Stores a token pair for deep-link handoff and returns its one-time code. */
  createHandoff(tokens: TokenPair): string {
    this.pruneHandoffs();
    const code = randomBytes(32).toString('base64url');
    this.handoffs.set(code, { tokens, expiresAt: Date.now() + HANDOFF_TTL_MS });
    return code;
  }

  /** Redeems a handoff code. Each code works exactly once. */
  redeemHandoff(code: string): TokenPair {
    this.pruneHandoffs();
    const entry = this.handoffs.get(code);
    if (!entry) throw new BadRequestException('This sign-in link is no longer valid');
    this.handoffs.delete(code);
    return entry.tokens;
  }

  private pruneHandoffs(): void {
    const now = Date.now();
    for (const [code, entry] of this.handoffs) {
      if (entry.expiresAt <= now) this.handoffs.delete(code);
    }
  }

  /** Google sign-in is optional: without credentials the routes stay closed. */
  get enabled(): boolean {
    return Boolean(
      this.config.get('GOOGLE_CLIENT_ID', { infer: true }) &&
      this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }) &&
      this.config.get('GOOGLE_CALLBACK_URL', { infer: true }),
    );
  }

  private require<K extends keyof Environment>(key: K): NonNullable<Environment[K]> {
    const value = this.config.get(key, { infer: true });
    if (!value) throw new NotFoundException('Google sign-in is not configured');
    return value as NonNullable<Environment[K]>;
  }

  /**
   * Builds the consent-screen URL. `state` is signed rather than stored so the
   * callback can be served by any instance without shared session storage.
   */
  authorizationUrl(client: OAuthClient): string {
    if (!this.enabled) throw new NotFoundException('Google sign-in is not configured');
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', this.require('GOOGLE_CLIENT_ID'));
    url.searchParams.set('redirect_uri', this.require('GOOGLE_CALLBACK_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', this.signState(client));
    // Always show the picker so a shared device cannot silently reuse a session.
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  /** Where the browser is sent once the session cookies are set. */
  successUrl(client: OAuthClient): string {
    return client === 'mobile'
      ? this.require('GOOGLE_MOBILE_SUCCESS_URL')
      : this.require('GOOGLE_WEB_SUCCESS_URL');
  }

  /** Exchanges the one-time code for a session, linking or creating the user. */
  async completeSignIn(
    code: string,
    state: string,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<{ tokens: TokenPair; client: OAuthClient }> {
    const client = this.verifyState(state);
    const claims = await this.exchangeCode(code);
    const tokens = await this.resolveUser(claims, context);
    return { tokens, client };
  }

  private async exchangeCode(code: string): Promise<GoogleClaims> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.require('GOOGLE_CLIENT_ID'),
        client_secret: this.require('GOOGLE_CLIENT_SECRET'),
        redirect_uri: this.require('GOOGLE_CALLBACK_URL'),
        grant_type: 'authorization_code',
      }),
    }).catch(() => null);

    if (!response?.ok) {
      // The body can echo the client secret, so it is never logged.
      this.logger.warn({ event: 'google_token_exchange_failed', status: response?.status });
      throw new BadRequestException('Google sign-in failed');
    }
    const payload = (await response.json().catch(() => null)) as { id_token?: string } | null;
    if (!payload?.id_token) throw new BadRequestException('Google sign-in failed');

    return this.verifyIdToken(payload.id_token);
  }

  /** Verifies the ID token with Google, then re-checks audience and issuer. */
  private async verifyIdToken(idToken: string): Promise<GoogleClaims> {
    const response = await fetch(
      `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`,
    ).catch(() => null);
    if (!response?.ok) {
      this.logger.warn({ event: 'google_id_token_rejected', status: response?.status });
      throw new BadRequestException('Google sign-in failed');
    }
    const claims = (await response.json().catch(() => null)) as
      (GoogleClaims & { aud?: string; iss?: string; exp?: string }) | null;
    if (
      !claims?.sub ||
      claims.aud !== this.require('GOOGLE_CLIENT_ID') ||
      !GOOGLE_ISSUERS.has(claims.iss ?? '') ||
      Number(claims.exp) * 1000 <= Date.now()
    ) {
      throw new BadRequestException('Google sign-in failed');
    }
    return claims;
  }

  private async resolveUser(
    claims: GoogleClaims,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const email = claims.email?.trim().toLowerCase();
    // Google's own verification is what makes auto-linking safe; without it an
    // attacker could claim any address.
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    if (!email || !emailVerified) {
      throw new BadRequestException('A verified Google email address is required');
    }

    const existingIdentity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: IdentityProvider.GOOGLE,
          providerUserId: claims.sub,
        },
      },
      include: { user: true },
    });

    if (existingIdentity) {
      if (existingIdentity.user.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('This account is not available');
      }
      await this.prisma.userIdentity.update({
        where: { id: existingIdentity.id },
        data: { lastLoginAt: new Date(), email },
      });
      return this.auth.createSessionForUser(existingIdentity.userId, context);
    }

    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.status === UserStatus.SUSPENDED || byEmail.status === UserStatus.DEACTIVATED) {
        throw new BadRequestException('This account is not available');
      }
      // Google verified the address, so linking also completes any pending
      // email verification for the existing account.
      await this.prisma.$transaction([
        this.prisma.userIdentity.create({
          data: {
            userId: byEmail.id,
            provider: IdentityProvider.GOOGLE,
            providerUserId: claims.sub,
            email,
            lastLoginAt: new Date(),
          },
        }),
        this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            status: UserStatus.ACTIVE,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
          },
        }),
      ]);
      return this.auth.createSessionForUser(byEmail.id, context);
    }

    const { firstName, lastName } = splitName(claims);
    const created = await this.prisma.user.create({
      data: {
        email,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        profile: { create: { firstName, lastName } },
        wallets: { create: { currency: 'NGN' } },
        identities: {
          create: {
            provider: IdentityProvider.GOOGLE,
            providerUserId: claims.sub,
            email,
            lastLoginAt: new Date(),
          },
        },
      },
    });
    return this.auth.createSessionForUser(created.id, context);
  }

  /** `<client>.<expiry>.<hmac>` — self-contained and tamper-evident. */
  private signState(client: OAuthClient): string {
    const payload = `${client}.${Date.now() + STATE_TTL_MS}.${randomBytes(16).toString('hex')}`;
    return `${payload}.${this.stateSignature(payload)}`;
  }

  private verifyState(state: string): OAuthClient {
    const index = state.lastIndexOf('.');
    if (index < 0) throw new BadRequestException('Google sign-in failed');
    const payload = state.slice(0, index);
    const provided = Buffer.from(state.slice(index + 1));
    const expected = Buffer.from(this.stateSignature(payload));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new BadRequestException('Google sign-in failed');
    }
    const [client, expiresAt] = payload.split('.');
    if (Number(expiresAt) < Date.now()) throw new BadRequestException('Google sign-in expired');
    return client === 'mobile' ? 'mobile' : 'web';
  }

  private stateSignature(payload: string): string {
    // Reuses TOKEN_PEPPER: state only needs integrity, not confidentiality.
    return createHmac('sha256', this.config.get('TOKEN_PEPPER', { infer: true }))
      .update(payload)
      .digest('hex');
  }
}

/** Google may send given/family names, one full name, or neither. */
function splitName(claims: GoogleClaims): { firstName: string; lastName: string } {
  const given = claims.given_name?.trim();
  const family = claims.family_name?.trim();
  if (given || family) return { firstName: given || family || 'Member', lastName: family || '—' };
  const parts = claims.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const [first, ...rest] = parts;
  if (rest.length > 0) return { firstName: first ?? 'Member', lastName: rest.join(' ') };
  return { firstName: first ?? 'Member', lastName: '—' };
}
