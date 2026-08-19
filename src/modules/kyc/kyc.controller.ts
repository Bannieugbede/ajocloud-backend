import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { InquireAccountDto } from './dto/inquire-account.dto.js';
import { LinkBankAccountDto } from './dto/link-bank-account.dto.js';
import { UpdatePersonalDetailsDto } from './dto/update-personal-details.dto.js';
import { VerifyIdentityDto } from './dto/verify-identity.dto.js';
import { KycService } from './kyc.service.js';

@ApiTags('kyc')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'kyc', version: '1' })
export class KycController {
  constructor(private readonly kyc: KycService) {}

  /** Step f: what remains, so the introduction screen states facts. */
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.status(user.userId);
  }

  /** Step g. */
  @Patch('personal-details')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updatePersonalDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePersonalDetailsDto,
  ) {
    return this.kyc.updatePersonalDetails(user.userId, dto);
  }

  /**
   * Step h. Rate limited tightly: this endpoint forwards an identity number to
   * the provider, so it is the one an attacker would use to enumerate.
   */
  @Post('identity')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  verifyIdentity(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyIdentityDto) {
    return this.kyc.verifyIdentity(user.userId, dto);
  }

  /** Step i: the bank dropdown. */
  @Get('banks')
  listBanks() {
    return this.kyc.listBanks();
  }

  /** Step i: resolve the name before linking. Stores nothing. */
  @Post('banks/inquire')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  inquireAccount(@Body() dto: InquireAccountDto) {
    return this.kyc.inquireAccount(dto);
  }

  @Post('bank-accounts')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  linkBankAccount(@CurrentUser() user: AuthenticatedUser, @Body() dto: LinkBankAccountDto) {
    return this.kyc.linkBankAccount(user.userId, dto);
  }

  @Get('bank-accounts')
  listBankAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.listBankAccounts(user.userId);
  }
}
