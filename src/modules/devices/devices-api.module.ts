import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DevicesController } from './devices.controller.js';
import { DevicesModule } from './devices.module.js';

/**
 * The routes a phone calls to register itself, kept apart from
 * `DevicesModule` so that the guard's dependency on `AuthModule` never travels
 * back into the notification path. See the note on `DevicesModule`.
 */
@Module({
  imports: [AuthModule, DevicesModule],
  controllers: [DevicesController],
})
export class DevicesApiModule {}
