import { Module } from '@nestjs/common';
import { MonnifyWebhooksController } from './monnify-webhooks.controller.js';
import { MonnifyWebhooksService } from './monnify-webhooks.service.js';

@Module({
  controllers: [MonnifyWebhooksController],
  providers: [MonnifyWebhooksService],
})
export class WebhooksModule {}
