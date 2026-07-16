import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import type { Environment } from '../config/env.schema.js';

export async function configureSecurity(
  app: NestFastifyApplication,
  env: Environment,
): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: env.NODE_ENV === 'production' });
  const origins = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origins.includes(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed'), false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
}
