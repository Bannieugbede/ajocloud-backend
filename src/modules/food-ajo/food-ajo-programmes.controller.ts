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
import { CreateFoodProgrammeDto } from './dto/create-food-programme.dto.js';
import { FoodProgrammeQueryDto } from './dto/food-programme-query.dto.js';
import { SubscribeFoodProgrammeDto } from './dto/subscribe-food-programme.dto.js';
import { FoodAjoProgrammesService } from './food-ajo-programmes.service.js';

@ApiTags('food-ajo')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'food-ajo/programmes', version: '1' })
export class FoodAjoProgrammesController {
  constructor(private readonly programmes: FoodAjoProgrammesService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFoodProgrammeDto) {
    return this.programmes.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: FoodProgrammeQueryDto) {
    return this.programmes.list(user.userId, query);
  }

  /** The caller's own enrolments. Declared before ':programmeId' so the
      literal path is not swallowed by the UUID param. */
  @Get('subscriptions/mine')
  mySubscriptions(@CurrentUser() user: AuthenticatedUser) {
    return this.programmes.mySubscriptions(user.userId);
  }

  @Get(':programmeId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
  ) {
    return this.programmes.get(user.userId, programmeId);
  }

  @Post(':programmeId/subscribe')
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Body() dto: SubscribeFoodProgrammeDto,
  ) {
    return this.programmes.subscribe(user.userId, programmeId, dto);
  }

  @Post(':programmeId/unsubscribe')
  unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
  ) {
    return this.programmes.cancelSubscription(user.userId, programmeId);
  }
}
