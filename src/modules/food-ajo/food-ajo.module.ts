import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FoodAjoProgrammesController } from './food-ajo-programmes.controller.js';
import { FoodAjoProgrammesService } from './food-ajo-programmes.service.js';

@Module({
  imports: [AuthModule],
  controllers: [FoodAjoProgrammesController],
  providers: [FoodAjoProgrammesService],
})
export class FoodAjoModule {}
