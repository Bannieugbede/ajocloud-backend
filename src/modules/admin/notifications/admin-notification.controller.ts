import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../../permissions/permissions.guard.js';
import { AdminNotificationService } from './admin-notification.service.js';

/**
 * The console's notification feed.
 *
 * Deliberately not behind a `staff.manage`-style permission: every staff member
 * has a feed, and what they may see is decided per notification by the service
 * rather than by gating the route. Reaching the admin console at all already
 * requires an authenticated session.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller({ path: 'admin/notifications', version: '1' })
export class AdminNotificationController {
  constructor(private readonly notifications: AdminNotificationService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user);
  }

  /**
   * Reconciles the feed against current platform state. Exposed so the console
   * can refresh on demand, and so a scheduled job has something to call.
   */
  @Post('sync')
  sync() {
    return this.notifications.sync();
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user);
  }

  @Post(':notificationId/read')
  markRead(
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.markRead(notificationId, user.userId);
  }
}
