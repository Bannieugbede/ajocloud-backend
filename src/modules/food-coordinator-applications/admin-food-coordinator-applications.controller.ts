import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../permissions/permissions.guard.js';
import {
  ApproveFoodCoordinatorApplicationDto,
  ReviewFoodCoordinatorApplicationDto,
} from './dto/review-food-coordinator-application.dto.js';
import { FoodCoordinatorApplicationsService } from './food-coordinator-applications.service.js';

@ApiTags('admin-food-coordinator-applications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('food-coordinators.review')
@Controller({ path: 'admin/food-coordinator-applications', version: '1' })
export class AdminFoodCoordinatorApplicationsController {
  constructor(private readonly applications: FoodCoordinatorApplicationsService) {}

  @Get()
  list() {
    return this.applications.listForReview();
  }

  @Get(':applicationId')
  get(@Param('applicationId', ParseUUIDPipe) applicationId: string) {
    return this.applications.getForReview(applicationId);
  }

  @Post(':applicationId/request-information')
  requestInformation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ReviewFoodCoordinatorApplicationDto,
  ) {
    return this.applications.requestInformation(user.userId, applicationId, dto);
  }

  @Post(':applicationId/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ApproveFoodCoordinatorApplicationDto,
  ) {
    return this.applications.approve(user.userId, applicationId, dto);
  }

  @Post(':applicationId/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ReviewFoodCoordinatorApplicationDto,
  ) {
    return this.applications.reject(user.userId, applicationId, dto);
  }

  @Post(':applicationId/suspend')
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ReviewFoodCoordinatorApplicationDto,
  ) {
    return this.applications.suspend(user.userId, applicationId, dto);
  }
}
