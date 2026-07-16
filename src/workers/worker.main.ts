import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  context.useLogger(context.get(Logger));
  context.enableShutdownHooks();
}
void bootstrap();
