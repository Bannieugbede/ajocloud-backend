import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReferralsController } from './referrals.controller.js';
import { ReferralsModule } from './referrals.module.js';

/** The caller-facing referral route. See the note on `ReferralsModule`. */
@Module({
  imports: [AuthModule, ReferralsModule],
  controllers: [ReferralsController],
})
export class ReferralsApiModule {}
