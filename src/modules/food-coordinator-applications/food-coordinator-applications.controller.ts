import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { CreateFoodCoordinatorApplicationDto } from './dto/create-food-coordinator-application.dto.js';
import { FoodCoordinatorApplicationsService } from './food-coordinator-applications.service.js';
import { UpdateFoodCoordinatorApplicationDto } from './dto/update-food-coordinator-application.dto.js';

@ApiTags('food-coordinator-applications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'food-coordinator-applications', version: '1' })
export class FoodCoordinatorApplicationsController {
  constructor(private readonly applications: FoodCoordinatorApplicationsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFoodCoordinatorApplicationDto) {
    return this.applications.create(user.userId, dto);
  }

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.applications.listMine(user.userId);
  }

  @Patch(':applicationId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: UpdateFoodCoordinatorApplicationDto,
  ) {
    return this.applications.update(user.userId, applicationId, dto);
  }

  @Post(':applicationId/submit')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ) {
    return this.applications.submit(user.userId, applicationId);
  }
}
