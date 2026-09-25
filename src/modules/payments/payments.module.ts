import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { AuditModule } from '../audit/audit.module.js';
import { ReferralsModule } from '../referrals/referrals.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AjoContributionTarget } from '../ajo-groups/ajo-contribution.payment-target.js';
import { AjoGroupsModule } from '../ajo-groups/ajo-groups.module.js';
import { FoodAjoModule } from '../food-ajo/food-ajo.module.js';
import { FoodSubscriptionTarget } from '../food-ajo/food-subscription.payment-target.js';
import { PaymentTargetType } from '../../../generated/prisma/enums.js';
import { AkawoPoolDueTarget } from './targets/akawo-pool-due.target.js';
import {
  PAYMENT_TARGETS,
  type PaymentTarget,
  paymentTargetRegistry,
} from './targets/payment-target.js';
import { WalletTopUpTarget } from './targets/wallet-topup.target.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import { PAYMENT_PROVIDER } from './providers/payment-provider.js';

@Module({
  imports: [
    AuthModule,
    LedgerModule,
    AuditModule,
    FeesModule,
    NotificationsModule,
    ReferralsModule,
    // Each product owns the rules for paying for it; this module owns the
    // mechanics every payment shares. See ADR-013.
    AjoGroupsModule,
    FoodAjoModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentSettlementService,
    MockPaymentProvider,
    AkawoPoolDueTarget,
    WalletTopUpTarget,
    {
      provide: PAYMENT_TARGETS,
      inject: [
        AkawoPoolDueTarget,
        AjoContributionTarget,
        FoodSubscriptionTarget,
        WalletTopUpTarget,
      ],
      // Every target type must have exactly one handler, checked at boot so a
      // new type without one fails the deploy rather than a member's payment.
      useFactory: (...targets: PaymentTarget[]) =>
        paymentTargetRegistry(Object.values(PaymentTargetType), targets),
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, MockPaymentProvider],
      useFactory: (config: ConfigService<Environment, true>, mock: MockPaymentProvider) => {
        // Monnify has no payment adapter yet (only bill payments and KYC are
        // wired). Selecting 'monnify' therefore still resolves to the mock; the
        // factory is here so the real adapter is a one-line swap rather than a
        // structural change.
        void config;
        return mock;
      },
    },
  ],
  exports: [PaymentsService, PaymentSettlementService],
})
export class PaymentsModule {}
