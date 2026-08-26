import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator.js';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../../permissions/permissions.guard.js';
import { InviteStaffDto } from '../dto/staff-invite.dto.js';
import { StaffInviteService } from './staff-invite.service.js';
import { INVITABLE_ROLES, humaniseRole } from './staff-roles.js';

/**
 * Staff administration. Inviting a colleague grants standing access to customer
 * and financial data, so it sits behind `staff.manage` rather than any of the
 * read permissions the rest of the console uses.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller({ path: 'admin/staff', version: '1' })
export class StaffInviteController {
  constructor(private readonly invites: StaffInviteService) {}

  /** The roles the console may offer, so the UI never invents one. */
  @Get('roles')
  @RequirePermissions('staff.manage')
  roles() {
    return {
      items: INVITABLE_ROLES.map((role) => ({ value: role, label: humaniseRole(role) })),
    };
  }

  @Get('invites')
  @RequirePermissions('staff.manage')
  list() {
    return this.invites.list();
  }

  @Post('invites')
  @RequirePermissions('staff.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  invite(@Body() dto: InviteStaffDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invites.invite(dto, user.userId);
  }

  @Post('invites/:inviteId/revoke')
  @RequirePermissions('staff.manage')
  revoke(
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.revoke(inviteId, user.userId);
  }
}
