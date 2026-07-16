import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Environment } from '../config/env.schema.js';

export function configureSwagger(app: NestFastifyApplication, env: Environment): void {
  if (!env.SWAGGER_ENABLED) return;
  const config = new DocumentBuilder()
    .setTitle('Ajo Cloud API')
    .setDescription('Secure cooperative savings API')
    .setVersion(env.APP_VERSION)
    .addBearerAuth()
    .build();
  SwaggerModule.setup(`${env.API_PREFIX}/docs`, app, SwaggerModule.createDocument(app, config));
}
