import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../permissions/permissions.guard.js';
import { BillPaymentsService } from './bill-payments.service.js';

@ApiTags('admin-bill-payments')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('bill-payments.reconcile')
@Controller({ path: 'admin/bill-payments', version: '1' })
export class AdminBillPaymentsController {
  constructor(private readonly bills: BillPaymentsService) {}

  @Post(':paymentId/reconcile')
  reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.bills.reconcile(user.userId, paymentId);
  }
}
