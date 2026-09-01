import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../permissions/permissions.guard.js';
import { ApproveKycProfileDto, ReviewKycProfileDto } from './dto/review-kyc-profile.dto.js';
import { KycReviewService } from './kyc-review.service.js';

@ApiTags('admin-kyc-review')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('kyc.review')
@Controller({ path: 'admin/kyc-profiles', version: '1' })
export class AdminKycReviewController {
  constructor(private readonly reviews: KycReviewService) {}

  @Get()
  queue() {
    return this.reviews.listQueue();
  }

  @Get(':kycProfileId')
  get(@Param('kycProfileId', ParseUUIDPipe) kycProfileId: string) {
    return this.reviews.getForReview(kycProfileId);
  }

  @Post(':kycProfileId/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kycProfileId', ParseUUIDPipe) kycProfileId: string,
    @Body() dto: ApproveKycProfileDto,
  ) {
    return this.reviews.approve(user.userId, kycProfileId, dto);
  }

  @Post(':kycProfileId/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kycProfileId', ParseUUIDPipe) kycProfileId: string,
    @Body() dto: ReviewKycProfileDto,
  ) {
    return this.reviews.reject(user.userId, kycProfileId, dto);
  }

  @Post(':kycProfileId/request-information')
  requestInformation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kycProfileId', ParseUUIDPipe) kycProfileId: string,
    @Body() dto: ReviewKycProfileDto,
  ) {
    return this.reviews.requestInformation(user.userId, kycProfileId, dto);
  }

  @Post(':kycProfileId/escalate')
  escalate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kycProfileId', ParseUUIDPipe) kycProfileId: string,
    @Body() dto: ReviewKycProfileDto,
  ) {
    return this.reviews.escalate(user.userId, kycProfileId, dto);
  }
}
