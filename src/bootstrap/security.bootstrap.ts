import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import type { Environment } from '../config/env.schema.js';
import { CSRF_HEADER } from '../modules/auth/session-cookie.js';

/**
 * Loopback origins on any port, e.g. http://localhost:3001, http://127.0.0.1:3000.
 * Accepted only outside production so web devs can run Next.js on whichever port
 * is free without re-deploying the API to widen CORS_ORIGINS.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/** Builds the CORS origin predicate; exported so the rules can be unit-tested. */
export function createOriginPredicate(env: Environment): (origin: string) => boolean {
  const origins = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowLoopback = env.CORS_ALLOW_LOOPBACK && env.NODE_ENV !== 'production';
  return (origin) => origins.includes(origin) || (allowLoopback && LOOPBACK_ORIGIN.test(origin));
}

export async function configureSecurity(
  app: NestFastifyApplication,
  env: Environment,
): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: env.NODE_ENV === 'production' });
  await app.register(cookie, {
    ...(env.COOKIE_SECRET ? { secret: env.COOKIE_SECRET } : {}),
  });
  const isAllowed = createOriginPredicate(env);
  await app.register(cors, {
    origin: (origin, callback) => {
      // A missing Origin header means a same-origin or non-browser client.
      if (!origin || isAllowed(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed'), false);
    },
    // Browser sessions ride on cookies, so responses must permit credentials.
    // @fastify/cors echoes the specific origin (never '*') for these requests.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'Idempotency-Key', CSRF_HEADER],
  });
}
