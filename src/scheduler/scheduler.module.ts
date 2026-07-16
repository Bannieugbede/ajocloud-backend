import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigurationModule } from '../config/configuration.module.js';
import { LoggingModule } from '../infrastructure/logging/logging.module.js';

@Module({ imports: [ConfigurationModule, LoggingModule, ScheduleModule.forRoot()] })
export class SchedulerModule {}
