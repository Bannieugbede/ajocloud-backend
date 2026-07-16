import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { SchedulerModule } from './scheduler.module.js';

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(SchedulerModule, { bufferLogs: true });
  context.useLogger(context.get(Logger));
  context.enableShutdownHooks();
}
void bootstrap();
