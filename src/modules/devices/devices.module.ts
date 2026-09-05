import { Module } from '@nestjs/common';
import { DevicesService } from './devices.service.js';

/**
 * The device register itself, with no controller and so no `AuthModule`.
 *
 * `NotificationsModule` imports this to reach a user's push tokens, and
 * `AuthModule` imports `NotificationsModule` to send verification mail. Were
 * the guarded controller held here, that chain would close into a cycle —
 * `AuthModule` would still be evaluating when this file read `AccessTokenGuard`
 * from it, and Nest would be handed `undefined`. `DevicesApiModule` holds the
 * controller instead, mirroring how `NotificationPreferencesModule` keeps the
 * same dependency one-directional.
 */
@Module({
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
