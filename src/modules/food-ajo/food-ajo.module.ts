import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FoodAjoCoordinatorController } from './food-ajo-coordinator.controller.js';
import { FoodAjoCoordinatorService } from './food-ajo-coordinator.service.js';
import { FoodAjoProgrammesController } from './food-ajo-programmes.controller.js';
import { FoodAjoProgrammesService } from './food-ajo-programmes.service.js';

@Module({
  imports: [AuthModule],
  controllers: [FoodAjoProgrammesController, FoodAjoCoordinatorController],
  providers: [FoodAjoProgrammesService, FoodAjoCoordinatorService],
})
export class FoodAjoModule {}
