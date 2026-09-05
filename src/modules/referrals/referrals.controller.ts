import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { ReferralsService, type ReferralSummary } from './referrals.service.js';

/**
 * The caller's own referral standing. Scoped to the caller throughout: what
 * another member has earned is not information this route will disclose.
 */
@ApiTags('referrals')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'referrals', version: '1' })
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  /** Rewards earned so far, for the wallet summary. */
  @Get('me')
  summary(@CurrentUser() user: AuthenticatedUser): Promise<ReferralSummary> {
    return this.referrals.summaryFor(user.userId);
  }
}
