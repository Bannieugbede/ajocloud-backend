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
import { CreateSwapRequestDto, DecideSwapRequestDto } from './dto/create-swap-request.dto.js';
import { AjoSwapsService } from './ajo-swaps.service.js';

@ApiTags('ajo-groups')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller({ path: 'ajo-groups', version: '1' })
export class AjoGroupsController {
  constructor(
    private readonly groups: AjoGroupsService,
    private readonly swaps: AjoSwapsService,
  ) {}

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

  @Post(':groupId/swaps')
  @RequirePermissions('ajo.swap.initiate')
  createSwap(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: CreateSwapRequestDto,
  ) {
    return this.swaps.create(user.userId, groupId, dto);
  }

  @Post(':groupId/swaps/:swapId/approve')
  @RequirePermissions('ajo.swap.approve')
  approveSwap(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('swapId', ParseUUIDPipe) swapId: string,
    @Body() dto: DecideSwapRequestDto,
  ) {
    return this.swaps.approve(user.userId, groupId, swapId, dto);
  }

  @Post(':groupId/swaps/:swapId/reject')
  rejectSwap(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('swapId', ParseUUIDPipe) swapId: string,
    @Body() dto: DecideSwapRequestDto,
  ) {
    return this.swaps.reject(user.userId, groupId, swapId, dto);
  }
}
