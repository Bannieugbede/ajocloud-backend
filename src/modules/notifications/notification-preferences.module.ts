import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationPreferencesController } from './notification-preferences.controller.js';
import { NotificationsModule } from './notifications.module.js';

/**
 * The user-facing settings surface, kept separate from `NotificationsModule`.
 *
 * The controller needs `AuthModule` for the access-token guard, but
 * `AuthModule` already imports `NotificationsModule` to send verification and
 * reset mail. Holding the controller here keeps that dependency one-directional
 * instead of creating a cycle.
 */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [NotificationPreferencesController],
})
export class NotificationPreferencesModule {}
