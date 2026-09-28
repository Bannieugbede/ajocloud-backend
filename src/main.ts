import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap/app.bootstrap.js';
import { validateEnvironment } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const env = validateEnvironment(process.env);
  const adapter = new FastifyAdapter({
    // 2.5 MiB: room for a KYC document photo sent as base64 (ADR-015), whose
    // own limit is enforced where it is decoded.
    bodyLimit: 2_621_440,
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
