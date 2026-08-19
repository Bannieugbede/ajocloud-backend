import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import type { Environment } from '../../config/env.schema.js';
import { AuthService } from './auth.service.js';
import type { TokenPair } from './auth.service.js';
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  readCookie,
  setSessionCookies,
} from './session-cookie.js';
import { GoogleOAuthService, type OAuthClient } from './google-oauth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordlessService } from './passwordless.service.js';
import { RequestOtpDto, ResendOtpDto, VerifyOtpDto } from './dto/otp.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { GoogleExchangeDto } from './dto/google-exchange.dto.js';
import { CompletePasswordResetDto, RequestPasswordResetDto } from './dto/password-reset.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { TransactionPinService } from './transaction-pin.service.js';
import { SetTransactionPinDto, VerifyTransactionPinDto } from './dto/transaction-pin.dto.js';
import { ResendVerificationDto, VerifyAccountDto } from './dto/verify-account.dto.js';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordless: PasswordlessService,
    private readonly google: GoogleOAuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly transactionPin: TransactionPinService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  /** Cookie flags depend on deployment (same-site vs cross-site, domain). */
  private get cookieEnv(): Environment {
    return {
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
      API_PREFIX: this.config.get('API_PREFIX', { infer: true }),
      JWT_REFRESH_TTL_SECONDS: this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true }),
      SESSION_COOKIE_SAMESITE_NONE: this.config.get('SESSION_COOKIE_SAMESITE_NONE', {
        infer: true,
      }),
      SESSION_COOKIE_DOMAIN: this.config.get('SESSION_COOKIE_DOMAIN', { infer: true }),
    } as Environment;
  }

  /**
   * Issues the session cookies for a freshly minted token pair and returns the
   * body for the caller. Bearer clients still receive the tokens in the body;
   * browsers simply ignore them and rely on the cookies.
   */
  private issueSession(reply: FastifyReply, tokens: TokenPair): TokenPair {
    setSessionCookies(reply, tokens, randomBytes(32).toString('hex'), this.cookieEnv);
    return tokens;
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.passwordless.requestCode(dto.email);
  }

  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.passwordless.resendCode(dto.challengeId);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const tokens = await this.passwordless.verifyCode(
      dto.challengeId,
      dto.code,
      this.context(request),
    );
    return this.issueSession(reply, tokens);
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto, @Req() request: FastifyRequest) {
    return this.auth.register(dto, this.context(request));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.issueSession(reply, await this.auth.login(dto, this.context(request)));
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(
    @Body() dto: VerifyAccountDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const tokens = await this.auth.verifyEmail(dto.userId, dto.code, this.context(request));
    return this.issueSession(reply, tokens);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto.userId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // Browsers send the rotating refresh token as an httpOnly cookie; mobile
    // clients still post it in the body.
    const refreshToken = readCookie(request, REFRESH_COOKIE) ?? dto.refreshToken;
    if (!refreshToken) throw new UnauthorizedException('Authentication required');
    return this.issueSession(reply, await this.auth.refresh(refreshToken));
  }

  /**
   * Starts Google sign-in. Both web and mobile open this URL in a browser; the
   * `client` parameter only decides where the callback returns to.
   */
  @Get('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  startGoogle(
    @Query('client') client: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): void {
    void reply.redirect(this.google.authorizationUrl(toOAuthClient(client)), HttpStatus.FOUND);
  }

  /**
   * Google redirects the browser here. The session cookies are set on this
   * response, then the browser is sent to the client's own success URL: the
   * tokens never travel in a query string where they could be logged.
   */
  @Get('google/callback')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    if (error || !code || !state) {
      // The user declined, or Google returned an incomplete callback.
      void reply.redirect(
        `${this.google.successUrl('web')}?error=google_sign_in_failed`,
        HttpStatus.FOUND,
      );
      return;
    }
    const { tokens, client } = await this.google.completeSignIn(code, state, this.context(request));

    if (client === 'mobile') {
      // Native clients keep tokens in SecureStore, and a deep-link URL can be
      // recorded by the OS, so the link carries a one-time code instead.
      const handoff = this.google.createHandoff(tokens);
      const target = new URL(this.google.successUrl('mobile'));
      target.searchParams.set('code', handoff);
      void reply.redirect(target.toString(), HttpStatus.FOUND);
      return;
    }

    this.issueSession(reply, tokens);
    void reply.redirect(this.google.successUrl('web'), HttpStatus.FOUND);
  }

  /** Exchanges a mobile handoff code for the token pair, over TLS. */
  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  exchangeGoogle(@Body() dto: GoogleExchangeDto): TokenPair {
    return this.google.redeemHandoff(dto.code);
  }

  /** Starts a password reset. Always succeeds, so it cannot enumerate accounts. */
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.passwordReset.requestReset(dto.email);
  }

  /** Verifies the emailed code and sets the new password. */
  @Post('password-reset/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async completePasswordReset(@Body() dto: CompletePasswordResetDto): Promise<void> {
    await this.passwordReset.completeReset(dto.challengeId, dto.code, dto.password);
  }

  @Get('transaction-pin')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  transactionPinStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.transactionPin.status(user.userId);
  }

  @Post('transaction-pin')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setTransactionPin(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetTransactionPinDto) {
    return this.transactionPin.setPin(user.userId, dto.pin, dto.currentPin);
  }

  @Post('transaction-pin/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyTransactionPin(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyTransactionPinDto,
  ): Promise<void> {
    await this.transactionPin.verifyPin(user.userId, dto.pin);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(user.sessionId);
    clearSessionCookies(reply, this.cookieEnv);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logoutAll(user.userId);
    clearSessionCookies(reply, this.cookieEnv);
  }

  private context(request: FastifyRequest): { ipAddress: string; userAgent?: string } {
    const userAgent = request.headers['user-agent'];
    return { ipAddress: request.ip, ...(userAgent ? { userAgent } : {}) };
  }
}

/** Only two callers exist; anything else is treated as the web client. */
function toOAuthClient(value: string | undefined): OAuthClient {
  return value === 'mobile' ? 'mobile' : 'web';
}
