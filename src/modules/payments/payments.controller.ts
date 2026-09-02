import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { ConfirmIntentDto } from './dto/confirm-intent.dto.js';
import { CreateIntentDto } from './dto/create-intent.dto.js';
import { PaymentsService } from './payments.service.js';

/** Rejects a missing or oversized key before any work is done. */
function requireIdempotencyKey(key: string | undefined): string {
  if (!key || key.length < 8 || key.length > 128) {
    throw new BadRequestException('A valid Idempotency-Key header is required');
  }
  return key;
}

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Creates an intent for a target. The amount is resolved server-side; the
   * request body carries no amount.
   */
  @Post('intents')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateIntentDto,
  ) {
    return this.payments.create(user.userId, dto, requireIdempotencyKey(idempotencyKey));
  }

  /**
   * Confirms a payment with a method and the transaction PIN.
   *
   * Throttled more tightly than ordinary routes: this endpoint accepts a PIN,
   * and the per-user lockout should not be the only thing standing between an
   * attacker and 10,000 guesses.
   */
  @Post('intents/:intentId/confirm')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('intentId', ParseUUIDPipe) intentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConfirmIntentDto,
  ) {
    return this.payments.confirm(user.userId, intentId, dto, requireIdempotencyKey(idempotencyKey));
  }

  /** Polled while a payment is PROCESSING, e.g. awaiting a bank transfer. */
  @Get('intents/:intentId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('intentId', ParseUUIDPipe) intentId: string) {
    return this.payments.get(user.userId, intentId);
  }
}
