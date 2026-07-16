import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { BillPaymentsService } from './bill-payments.service.js';
import { CreateBillPaymentDto } from './dto/create-bill-payment.dto.js';
import { ValidateBillCustomerDto } from './dto/validate-bill-customer.dto.js';

@ApiTags('bill-payments')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'bill-payments', version: '1' })
export class BillPaymentsController {
  constructor(private readonly bills: BillPaymentsService) {}

  @Get('categories')
  categories() {
    return this.bills.categories();
  }

  @Get('billers')
  billers(@Query('categoryId', ParseUUIDPipe) categoryId: string) {
    return this.bills.billers(categoryId);
  }

  @Post('validate-customer')
  validate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ValidateBillCustomerDto) {
    return this.bills.validateCustomer(user.userId, dto);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateBillPaymentDto,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new BadRequestException('A valid Idempotency-Key header is required');
    }
    return this.bills.create(user.userId, idempotencyKey, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.bills.list(user.userId);
  }

  @Get(':paymentId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.bills.get(user.userId, paymentId);
  }
}
