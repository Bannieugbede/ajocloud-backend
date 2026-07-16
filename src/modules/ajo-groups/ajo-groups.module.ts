import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { AjoGroupsController } from './ajo-groups.controller.js';
import { AjoGroupsService } from './ajo-groups.service.js';
import { AjoSwapsService } from './ajo-swaps.service.js';

@Module({
  imports: [PermissionsModule],
  controllers: [AjoGroupsController],
  providers: [AjoGroupsService, AjoSwapsService],
})
export class AjoGroupsModule {}
