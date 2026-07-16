import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap/app.bootstrap.js';
import { validateEnvironment } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const env = validateEnvironment(process.env);
  const adapter = new FastifyAdapter({
    bodyLimit: 1_048_576,
    connectionTimeout: 10_000,
    keepAliveTimeout: 72_000,
    requestTimeout: 30_000,
    trustProxy: env.NODE_ENV === 'production',
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await configureApplication(app, env);
  await app.listen({ host: env.HOST, port: env.PORT });
}

void bootstrap();
