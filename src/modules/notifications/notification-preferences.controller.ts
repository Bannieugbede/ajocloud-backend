import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';

/**
 * A user's own notification settings. Scoped to the caller throughout: there is
 * no route here that reads or writes another user's preferences.
 *
 * Security and account-recovery messages are absent by design — they cannot be
 * declined, so the API never offers a switch for them.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'users/me/notification-preferences', version: '1' })
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.list(user.userId);
  }

  /** Replaces the settings named in the body. PUT rather than PATCH because
      each named preference is written whole. */
  @Put()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.preferences.update(user.userId, dto.preferences);
  }
}
