import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { AjoGroupsController } from './ajo-groups.controller.js';
import { AjoGroupsService } from './ajo-groups.service.js';
import { AjoSwapsService } from './ajo-swaps.service.js';
import { GroupInvitationsService } from './group-invitations.service.js';
import { PublicInvitationsController } from './public-invitations.controller.js';

@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [AjoGroupsController, PublicInvitationsController],
  providers: [AjoGroupsService, AjoSwapsService, GroupInvitationsService],
})
export class AjoGroupsModule {}
