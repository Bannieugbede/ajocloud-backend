import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module.js';
import { StaffInviteService } from './staff-invite.service.js';

/**
 * Holds the staff-invite domain on its own so both the admin console (which
 * issues invites) and auth (which redeems them) can depend on it without the
 * two modules importing each other.
 */
@Module({
  imports: [NotificationsModule],
  providers: [StaffInviteService],
  exports: [StaffInviteService],
})
export class StaffModule {}
