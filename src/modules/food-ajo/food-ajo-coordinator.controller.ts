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
import {
  ConfirmCollectionDto,
  CreateDistributionDto,
  CreatePurchaseOrderDto,
  CreateVendorDto,
  RecordReceiptDto,
  TransitionDistributionDto,
  TransitionProgrammeDto,
  TransitionPurchaseOrderDto,
  UpdateFoodPackageDto,
} from './dto/coordinator.dto.js';
import { FoodAjoCoordinatorService } from './food-ajo-coordinator.service.js';

/**
 * Coordinator-only operations on a programme. Ownership is enforced in the
 * service against the programme itself rather than by a role, because
 * coordinating one programme must not grant control of another.
 */
@ApiTags('food-ajo')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'food-ajo', version: '1' })
export class FoodAjoCoordinatorController {
  constructor(private readonly coordinator: FoodAjoCoordinatorService) {}

  @Get('vendors')
  listVendors() {
    return this.coordinator.listVendors();
  }

  @Post('vendors')
  proposeVendor(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVendorDto) {
    return this.coordinator.proposeVendor(user.userId, dto);
  }

  @Patch('programmes/:programmeId/status')
  transitionProgramme(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Body() dto: TransitionProgrammeDto,
  ) {
    return this.coordinator.transitionProgramme(user.userId, programmeId, dto);
  }

  @Patch('programmes/:programmeId/packages/:packageId')
  updatePackage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Param('packageId', ParseUUIDPipe) packageId: string,
    @Body() dto: UpdateFoodPackageDto,
  ) {
    return this.coordinator.updatePackage(user.userId, programmeId, packageId, dto);
  }

  @Get('programmes/:programmeId/procurement-plan')
  procurementPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
  ) {
    return this.coordinator.procurementPlan(user.userId, programmeId);
  }

  @Get('programmes/:programmeId/purchase-orders')
  listPurchaseOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
  ) {
    return this.coordinator.listPurchaseOrders(user.userId, programmeId);
  }

  @Post('programmes/:programmeId/purchase-orders')
  createPurchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.coordinator.createPurchaseOrder(user.userId, programmeId, dto);
  }

  @Patch('programmes/:programmeId/purchase-orders/:orderId/status')
  transitionPurchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: TransitionPurchaseOrderDto,
  ) {
    return this.coordinator.transitionPurchaseOrder(user.userId, programmeId, orderId, dto);
  }

  @Post('programmes/:programmeId/purchase-orders/:orderId/receipts')
  recordReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RecordReceiptDto,
  ) {
    return this.coordinator.recordReceipt(user.userId, programmeId, orderId, dto);
  }

  @Get('programmes/:programmeId/distributions')
  listDistributions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
  ) {
    return this.coordinator.listDistributions(user.userId, programmeId);
  }

  @Post('programmes/:programmeId/distributions')
  createDistribution(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Body() dto: CreateDistributionDto,
  ) {
    return this.coordinator.createDistribution(user.userId, programmeId, dto);
  }

  @Patch('programmes/:programmeId/distributions/:distributionId/status')
  transitionDistribution(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Param('distributionId', ParseUUIDPipe) distributionId: string,
    @Body() dto: TransitionDistributionDto,
  ) {
    return this.coordinator.transitionDistribution(user.userId, programmeId, distributionId, dto);
  }

  @Post('programmes/:programmeId/distributions/:distributionId/confirm')
  confirmCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Param('distributionId', ParseUUIDPipe) distributionId: string,
    @Body() dto: ConfirmCollectionDto,
  ) {
    return this.coordinator.confirmCollection(user.userId, programmeId, distributionId, dto);
  }

  /**
   * Issued to the member, not the coordinator: a coordinator who could mint and
   * redeem a code could record food as collected that nobody received. Not
   * nested under a programme because the member reaches it from their own
   * enrolment.
   */
  @Post('distributions/:distributionId/collection-code')
  issueCollectionCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('distributionId', ParseUUIDPipe) distributionId: string,
  ) {
    return this.coordinator.issueCollectionCode(user.userId, distributionId);
  }
}
