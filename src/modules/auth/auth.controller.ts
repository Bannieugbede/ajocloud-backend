import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
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
import { PasswordlessService } from './passwordless.service.js';
import { RequestOtpDto, ResendOtpDto, VerifyOtpDto } from './dto/otp.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { ResendVerificationDto, VerifyAccountDto } from './dto/verify-account.dto.js';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordless: PasswordlessService,
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
