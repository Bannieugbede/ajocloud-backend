import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { MonnifyWebhooksController } from './monnify-webhooks.controller.js';
import { MonnifyWebhooksService } from './monnify-webhooks.service.js';

@Module({
  imports: [PaymentsModule],
  controllers: [MonnifyWebhooksController],
  providers: [MonnifyWebhooksService],
})
export class WebhooksModule {}
