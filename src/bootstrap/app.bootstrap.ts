import { ClassSerializerInterceptor, ValidationPipe, VersioningType } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { BigIntSerializerInterceptor } from '../common/interceptors/bigint-serializer.interceptor.js';
import type { Environment } from '../config/env.schema.js';
import { configureRawBody } from './raw-body.bootstrap.js';
import { configureSecurity } from './security.bootstrap.js';
import { configureSwagger } from './swagger.bootstrap.js';

export async function configureApplication(
  app: NestFastifyApplication,
  env: Environment,
): Promise<void> {
  // Must precede route registration: webhook signature checks need the
  // unparsed body, and a content-type parser cannot be added afterwards.
  configureRawBody(app);
  app.setGlobalPrefix(env.API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new BigIntSerializerInterceptor(),
  );
  app.enableShutdownHooks();
  await configureSecurity(app, env);
  configureSwagger(app, env);
}
