import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PaymentsService } from '../payments/payments.service.js';
import { WalletsService } from './wallets.service.js';

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'wallets', version: '1' })
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly payments: PaymentsService,
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
