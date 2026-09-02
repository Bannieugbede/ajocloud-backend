import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';

@Module({
  // PaymentsModule supplies the balance the payment screens read; it is the
  // module that owns how an available balance is computed for a payment.
  imports: [AuthModule, PaymentsModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
