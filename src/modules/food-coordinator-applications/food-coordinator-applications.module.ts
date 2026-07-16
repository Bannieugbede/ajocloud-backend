import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { AdminFoodCoordinatorApplicationsController } from './admin-food-coordinator-applications.controller.js';
import { FoodCoordinatorApplicationsController } from './food-coordinator-applications.controller.js';
import { FoodCoordinatorApplicationsService } from './food-coordinator-applications.service.js';

@Module({
  imports: [PermissionsModule],
  controllers: [FoodCoordinatorApplicationsController, AdminFoodCoordinatorApplicationsController],
  providers: [FoodCoordinatorApplicationsService],
})
export class FoodCoordinatorApplicationsModule {}
