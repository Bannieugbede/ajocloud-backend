import { Global, Module } from '@nestjs/common';
import { EVENT_PUBLISHER } from './domain-event.js';
import { RabbitMqService } from './rabbitmq.service.js';

@Global()
@Module({
  providers: [RabbitMqService, { provide: EVENT_PUBLISHER, useExisting: RabbitMqService }],
  exports: [RabbitMqService, EVENT_PUBLISHER],
})
export class MessagingModule {}
