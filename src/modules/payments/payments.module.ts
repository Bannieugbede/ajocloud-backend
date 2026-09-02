import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import { PAYMENT_PROVIDER } from './providers/payment-provider.js';

@Module({
  imports: [AuthModule, LedgerModule, AuditModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    MockPaymentProvider,
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
  exports: [PaymentsService],
})
export class PaymentsModule {}
