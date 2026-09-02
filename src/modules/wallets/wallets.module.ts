import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';
import { WalletMovementsService } from './wallet-movements.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

@Module({
  // PaymentsModule supplies the balance the payment screens read; it is the
  // module that owns how an available balance is computed for a payment.
  imports: [AuthModule, PaymentsModule, LedgerModule, AuditModule],
  controllers: [WalletsController],
  providers: [WalletsService, WalletMovementsService],
})
export class WalletsModule {}
