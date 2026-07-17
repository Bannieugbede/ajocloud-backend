import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { WalletsService } from './wallets.service.js';

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'wallets', version: '1' })
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.wallets.list(user.userId);
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
