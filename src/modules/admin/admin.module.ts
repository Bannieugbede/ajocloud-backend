import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminNotificationController } from './notifications/admin-notification.controller.js';
import { AdminNotificationService } from './notifications/admin-notification.service.js';
import { StaffInviteController } from './staff/staff-invite.controller.js';
import { StaffModule } from './staff/staff.module.js';

@Module({
  imports: [AuthModule, PermissionsModule, StaffModule],
  controllers: [AdminController, StaffInviteController, AdminNotificationController],
  providers: [AdminService, AdminNotificationService],
  exports: [AdminNotificationService],
})
export class AdminModule {}
