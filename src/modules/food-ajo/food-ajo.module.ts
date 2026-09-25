import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { FoodAjoCoordinatorController } from './food-ajo-coordinator.controller.js';
import { FoodAjoCoordinatorService } from './food-ajo-coordinator.service.js';
import { FoodAjoProgrammesController } from './food-ajo-programmes.controller.js';
import { FoodAjoProgrammesService } from './food-ajo-programmes.service.js';
import { FoodSubscriptionTarget } from './food-subscription.payment-target.js';
import { PublicFoodProgrammesController } from './public-food-programmes.controller.js';

@Module({
  imports: [AuthModule, LedgerModule],
  controllers: [
    FoodAjoProgrammesController,
    FoodAjoCoordinatorController,
    PublicFoodProgrammesController,
  ],
  providers: [FoodAjoProgrammesService, FoodAjoCoordinatorService, FoodSubscriptionTarget],
  // Exported for the shared payment contract, which settles enrolments.
  exports: [FoodSubscriptionTarget],
})
export class FoodAjoModule {}
