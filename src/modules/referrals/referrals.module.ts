import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ReferralsService } from './referrals.service.js';

/**
 * Referral qualification and reward issuance. See ADR-012.
 *
 * Deliberately carries no controller and so no `AuthModule`. The payment
 * settlement path imports this to consider a settled deposit for a reward, and
 * pulling the access-token guard along that edge is how DevicesModule ended up
 * in an import cycle that stopped the application booting. `ReferralsApiModule`
 * holds the route.
 */
@Module({
  imports: [LedgerModule],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
