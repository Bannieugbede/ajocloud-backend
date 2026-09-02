import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { DevicesService } from './devices.service.js';
import { RegisterDeviceDto } from './dto/register-device.dto.js';

/**
 * A user's own devices. Every route is scoped to the caller: a device is a way
 * of reaching a specific person, so no route here reads or writes another
 * user's registrations.
 */
@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'devices', version: '1' })
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Registers this installation. Called after signing in, and again whenever
      the push token changes — Expo can rotate it at any time. */
  @Post()
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.devices.register(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.devices.list(user.userId);
  }

  /** Stops notifications reaching one device. The record is kept, because it is
      evidence that this installation was signed in. */
  @Delete(':deviceId')
  deregister(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    return this.devices.deregister(user.userId, deviceId);
  }
}
