import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module.js';
import { LoggingModule } from '../infrastructure/logging/logging.module.js';
import { MessagingModule } from '../infrastructure/messaging/messaging.module.js';

@Module({ imports: [ConfigurationModule, LoggingModule, MessagingModule] })
export class WorkerModule {}
