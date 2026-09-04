import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import { AjoSettlementService } from './ajo-settlement.service.js';
import { AjoSwapsService } from './ajo-swaps.service.js';
import { PayContributionDto } from './dto/pay-contribution.dto.js';
import { CreateGroupInvitationDto } from './dto/create-group-invitation.dto.js';
import { GroupInvitationsService } from './group-invitations.service.js';

@ApiTags('ajo-groups')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller({ path: 'ajo-groups', version: '1' })
export class AjoGroupsController {
  constructor(
    private readonly groups: AjoGroupsService,
    private readonly swaps: AjoSwapsService,
    private readonly invitations: GroupInvitationsService,
    private readonly settlement: AjoSettlementService,
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

  /**
   * Resolves an invitation code to the group it admits.
   *
   * Authenticated, unlike the public preview: this hands back a group id, which
   * is what the join call needs and what the anonymous preview deliberately
   * withholds.
   */
  @Get('invitations/:code/group')
  resolveInvitation(@Param('code') code: string) {
    return this.invitations.resolveGroup(code);
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

  /**
   * Issues a shareable invitation link. The code is returned once, here: only
   * its digest is stored, so it cannot be recovered afterwards.
   */
  @Post(':groupId/invitations')
  createInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: CreateGroupInvitationDto,
  ) {
    return this.invitations.create(user.userId, groupId, dto);
  }

  @Get(':groupId/invitations')
  listInvitations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return this.invitations.list(user.userId, groupId);
  }

  @Delete(':groupId/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(user.userId, groupId, invitationId);
  }

  /**
   * Pays one of the caller's own contributions from their wallet. Partial
   * payment is allowed; the schedule advances to PAID only when it is whole.
   */
  @Post(':groupId/contributions/:scheduleId/pay')
  payContribution(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: PayContributionDto,
  ) {
    return this.settlement.payContribution(user.userId, groupId, scheduleId, dto);
  }

  /**
   * Pays a cycle's pool to the slot whose turn it is. Refused, and the schedule
   * held, unless every contribution in that cycle has been settled (ADR-011).
   */
  @Post(':groupId/payouts/:payoutScheduleId/execute')
  executePayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('payoutScheduleId', ParseUUIDPipe) payoutScheduleId: string,
  ) {
    return this.settlement.executePayout(user.userId, groupId, payoutScheduleId);
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

  /** Swaps on this group, including which await the caller's own decision.
      Without this a member could only act on a swap whose id they already had. */
  @Get(':groupId/swaps')
  listSwaps(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return this.swaps.list(user.userId, groupId);
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
