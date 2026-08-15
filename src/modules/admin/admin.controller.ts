import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../permissions/permissions.guard.js';
import { AdminService } from './admin.service.js';
import { AdminListQueryDto } from './dto/admin-query.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @RequirePermissions('audit.read')
  overview() {
    return this.admin.overview();
  }

  @Get('overview/volume-series')
  @RequirePermissions('audit.read')
  volumeSeries() {
    return this.admin.volumeSeries();
  }

  @Get('overview/active-groups')
  @RequirePermissions('audit.read')
  activeGroups() {
    return this.admin.activeGroups();
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.currentUser(user.userId, user.permissions);
  }

  @Get('users')
  @RequirePermissions('users.read')
  listUsers(@Query() query: AdminListQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('users/:userId')
  @RequirePermissions('users.read')
  getUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.admin.getUser(userId);
  }

  @Get('ajo-groups')
  @RequirePermissions('ajo.manage')
  listAjoGroups(@Query() query: AdminListQueryDto) {
    return this.admin.listAjoGroups(query);
  }

  @Get('ajo-groups/:groupId')
  @RequirePermissions('ajo.manage')
  getAjoGroup(@Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.admin.getAjoGroup(groupId);
  }

  @Get('akawo/goals')
  @RequirePermissions('users.read')
  listAkawoGoals(@Query() query: AdminListQueryDto) {
    return this.admin.listAkawoGoals(query);
  }

  @Get('food-ajo')
  @RequirePermissions('food-coordinators.review')
  listFoodAjo(@Query() query: AdminListQueryDto) {
    return this.admin.listFoodAjo(query);
  }

  @Get('bill-payments')
  @RequirePermissions('bill-payments.reconcile')
  listBillPayments(@Query() query: AdminListQueryDto) {
    return this.admin.listBillPayments(query);
  }

  @Get('ledger')
  @RequirePermissions('audit.read')
  listLedger(@Query() query: AdminListQueryDto) {
    return this.admin.listLedger(query);
  }

  @Get('kyc')
  @RequirePermissions('kyc.review')
  listKyc(@Query() query: AdminListQueryDto) {
    return this.admin.listKyc(query);
  }

  @Get('coordinators')
  @RequirePermissions('food-coordinators.review')
  listCoordinators(@Query() query: AdminListQueryDto) {
    return this.admin.listCoordinators(query);
  }

  @Get('waitlist')
  @RequirePermissions('users.read')
  listWaitlist(@Query() query: AdminListQueryDto) {
    return this.admin.listWaitlist(query);
  }

  @Get('support-inquiries')
  @RequirePermissions('users.read')
  listSupportInquiries(@Query() query: AdminListQueryDto) {
    return this.admin.listSupportInquiries(query);
  }

  @Get('fees')
  @RequirePermissions('fees.manage')
  listFees() {
    return this.admin.listFees();
  }

  @Get('settings')
  @RequirePermissions('audit.read')
  getSettings() {
    return this.admin.getSettings();
  }
}
