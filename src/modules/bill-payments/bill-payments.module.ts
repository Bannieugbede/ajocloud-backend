import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { MonnifyBillPaymentProvider } from '../../infrastructure/external-services/monnify/monnify-bill-payment.provider.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { BillPaymentsController } from './bill-payments.controller.js';
import { AdminBillPaymentsController } from './admin-bill-payments.controller.js';
import { BillPaymentsService } from './bill-payments.service.js';
import { BILL_PAYMENT_PROVIDER } from './providers/bill-payment-provider.js';
import { MockBillPaymentProvider } from './providers/mock-bill-payment.provider.js';

@Module({
  imports: [LedgerModule],
  controllers: [BillPaymentsController, AdminBillPaymentsController],
  providers: [
    BillPaymentsService,
    MockBillPaymentProvider,
    MonnifyBillPaymentProvider,
    {
      provide: BILL_PAYMENT_PROVIDER,
      inject: [ConfigService, MockBillPaymentProvider, MonnifyBillPaymentProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        mock: MockBillPaymentProvider,
        monnify: MonnifyBillPaymentProvider,
      ) => (config.get('BILL_PAYMENT_PROVIDER', { infer: true }) === 'monnify' ? monnify : mock),
    },
  ],
})
export class BillPaymentsModule {}
