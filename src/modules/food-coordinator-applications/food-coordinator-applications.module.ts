import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { AdminFoodCoordinatorApplicationsController } from './admin-food-coordinator-applications.controller.js';
import { FoodCoordinatorApplicationsController } from './food-coordinator-applications.controller.js';
import { FoodCoordinatorApplicationsService } from './food-coordinator-applications.service.js';

@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [FoodCoordinatorApplicationsController, AdminFoodCoordinatorApplicationsController],
  providers: [FoodCoordinatorApplicationsService],
})
export class FoodCoordinatorApplicationsModule {}
