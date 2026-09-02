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
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PaymentsService } from '../payments/payments.service.js';
import { WalletsService } from './wallets.service.js';
import { WalletMovementsService } from './wallet-movements.service.js';
import { SendToWalletDto, WithdrawDto } from './dto/wallet-movement.dto.js';

/** Rejects a missing or oversized key before any work is done. */
function requireIdempotencyKey(key: string | undefined): string {
  if (!key || key.length < 8 || key.length > 128) {
    throw new BadRequestException('A valid Idempotency-Key header is required');
  }
  return key;
}

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'wallets', version: '1' })
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly payments: PaymentsService,
    private readonly movements: WalletMovementsService,
  ) {}
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.wallets.list(user.userId);
  }
  /**
   * Available balance for the caller's wallet, so a payment screen can show the
   * wallet method as affordable before the user commits to it.
   *
   * Declared before the ':walletId' routes: Nest matches in declaration order,
   * so a later 'me' would be swallowed by the UUID param and 404 on the pipe.
   */
  @Get('me/balance')
  balance(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.balance(user.userId);
  }

  /** Sends money to another member's wallet. Settles immediately. */
  @Post('send')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: SendToWalletDto,
  ) {
    return this.movements.send(user.userId, dto, requireIdempotencyKey(idempotencyKey));
  }

  /**
   * Requests a payout to a linked bank account. Reserves the funds and stops at
   * PENDING: the bank rail is not operated here yet.
   */
  @Post('withdrawals')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: WithdrawDto,
  ) {
    return this.movements.withdraw(user.userId, dto, requireIdempotencyKey(idempotencyKey));
  }

  /** The caller's transfers and withdrawals. Declared before ':walletId'. */
  @Get('me/movements')
  movements_(@CurrentUser() user: AuthenticatedUser) {
    return this.movements.movements(user.userId);
  }

  @Get(':walletId/transactions')
  transactions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('walletId', ParseUUIDPipe) walletId: string,
  ) {
    return this.wallets.transactions(user.userId, walletId);
  }
  @Get(':walletId/summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('walletId', ParseUUIDPipe) walletId: string,
  ) {
    return this.wallets.summary(user.userId, walletId);
  }
}
