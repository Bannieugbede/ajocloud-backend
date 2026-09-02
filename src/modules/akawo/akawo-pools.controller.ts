import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AkawoPoolsService } from './akawo-pools.service.js';
import {
  CreateAkawoPoolDto,
  JoinAkawoPoolDto,
  UpdateAkawoPoolDto,
  WaiveAkawoDueDto,
} from './dto/akawo-pool.dto.js';

@ApiTags('akawo-pools')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'akawo/pools', version: '1' })
export class AkawoPoolsController {
  constructor(private readonly pools: AkawoPoolsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAkawoPoolDto) {
    return this.pools.create(user.userId, dto);
  }

  /** Pools this user organises. */
  @Get('organised')
  listOrganised(@CurrentUser() user: AuthenticatedUser) {
    return this.pools.listOrganised(user.userId);
  }

  /** Pools this user has joined, each with their own due. */
  @Get('joined')
  listJoined(@CurrentUser() user: AuthenticatedUser) {
    return this.pools.listJoined(user.userId);
  }

  /**
   * Describes a pool from its join code so a joiner can confirm the name and
   * amount before committing. Reports an unknown code and an unavailable pool
   * identically.
   */
  @Get('preview')
  preview(@Query('joinCode') joinCode: string) {
    return this.pools.preview(joinCode ?? '');
  }

  @Post('join')
  join(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinAkawoPoolDto) {
    return this.pools.join(user.userId, dto);
  }

  /** The organiser's record: every member, reference, and payment state. */
  @Get(':poolId/organiser')
  organiserView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poolId', ParseUUIDPipe) poolId: string,
  ) {
    return this.pools.getOrganiserView(user.userId, poolId);
  }

  /** A member's own view: the pool, their due, and the totals. */
  @Get(':poolId')
  memberView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poolId', ParseUUIDPipe) poolId: string,
  ) {
    return this.pools.getMemberView(user.userId, poolId);
  }

  @Patch(':poolId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poolId', ParseUUIDPipe) poolId: string,
    @Body() dto: UpdateAkawoPoolDto,
  ) {
    return this.pools.update(user.userId, poolId, dto);
  }

  @Post(':poolId/open')
  open(@CurrentUser() user: AuthenticatedUser, @Param('poolId', ParseUUIDPipe) poolId: string) {
    return this.pools.open(user.userId, poolId);
  }

  @Post(':poolId/close')
  close(@CurrentUser() user: AuthenticatedUser, @Param('poolId', ParseUUIDPipe) poolId: string) {
    return this.pools.close(user.userId, poolId);
  }

  @Post(':poolId/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('poolId', ParseUUIDPipe) poolId: string) {
    return this.pools.cancel(user.userId, poolId);
  }

  @Post(':poolId/members/:memberId/remove')
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poolId', ParseUUIDPipe) poolId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.pools.removeMember(user.userId, poolId, memberId);
  }

  @Post(':poolId/members/:memberId/waive')
  waive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poolId', ParseUUIDPipe) poolId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: WaiveAkawoDueDto,
  ) {
    return this.pools.waiveDue(user.userId, poolId, memberId, dto);
  }
}
