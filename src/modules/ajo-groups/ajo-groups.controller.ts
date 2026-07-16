import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../permissions/permissions.guard.js';
import { AjoGroupsService } from './ajo-groups.service.js';
import { CreateAjoGroupDto } from './dto/create-ajo-group.dto.js';
import { JoinAjoGroupDto } from './dto/join-ajo-group.dto.js';

@ApiTags('ajo-groups')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller({ path: 'ajo-groups', version: '1' })
export class AjoGroupsController {
  constructor(private readonly groups: AjoGroupsService) {}

  @Post()
  @RequirePermissions('ajo.create')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAjoGroupDto) {
    return this.groups.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.groups.list(user.userId);
  }

  @Get(':groupId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.groups.get(user.userId, groupId);
  }

  @Post(':groupId/join')
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: JoinAjoGroupDto,
  ) {
    return this.groups.join(user.userId, groupId, dto);
  }

  @Post(':groupId/lock')
  @RequirePermissions('ajo.lock')
  lock(@CurrentUser() user: AuthenticatedUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.groups.lock(user.userId, groupId);
  }

  @Get(':groupId/schedule')
  schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return this.groups.schedule(user.userId, groupId);
  }
}
