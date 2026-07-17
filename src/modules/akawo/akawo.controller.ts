import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AkawoService } from './akawo.service.js';
import { AkawoStatementQueryDto } from './dto/akawo-statement-query.dto.js';
import { CreateAkawoGoalDto } from './dto/create-akawo-goal.dto.js';
import { CreateAkawoScheduleDto } from './dto/create-akawo-schedule.dto.js';

@ApiTags('akawo')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'akawo/goals', version: '1' })
export class AkawoController {
  constructor(private readonly akawo: AkawoService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAkawoGoalDto) {
    return this.akawo.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.akawo.list(user.userId);
  }

  @Get(':goalId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('goalId', ParseUUIDPipe) goalId: string) {
    return this.akawo.get(user.userId, goalId);
  }

  @Get(':goalId/statement')
  statement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Query() query: AkawoStatementQueryDto,
  ) {
    return this.akawo.statement(user.userId, goalId, query);
  }

  @Post(':goalId/schedules')
  createSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body() dto: CreateAkawoScheduleDto,
  ) {
    return this.akawo.createSchedule(user.userId, goalId, dto);
  }
}
