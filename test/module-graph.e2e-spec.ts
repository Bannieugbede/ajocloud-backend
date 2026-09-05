import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

/**
 * Proves the application's module graph can actually be built.
 *
 * Every other suite constructs the module or service under test directly, so
 * all of them stay green while the wiring between modules is broken — which is
 * exactly what happened: a circular import left `AuthModule` half-evaluated
 * when `DevicesModule` read it, Nest was handed `undefined`, and the first
 * thing to notice was production refusing to boot after a clean deploy.
 *
 * `compile()` runs the same dependency scan and provider instantiation that
 * `NestFactory.create` does. It stops short of `onModuleInit`, so nothing here
 * opens a database, Redis, or AMQP connection — a broken graph is caught in a
 * second, with no infrastructure.
 */
describe('application module graph', () => {
  // The scan instantiates providers, several of which read configuration as
  // they are constructed. These are syntactically valid throwaways; none is a
  // credential and nothing connects with them.
  const REQUIRED_ENVIRONMENT = {
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    RABBITMQ_URL: 'amqp://localhost:5672',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    TOKEN_PEPPER: 'z'.repeat(32),
  } as const;

  let saved: NodeJS.ProcessEnv;

  beforeAll(() => {
    saved = process.env;
    process.env = { ...process.env, ...REQUIRED_ENVIRONMENT };
  });

  afterAll(() => {
    process.env = saved;
  });

  it('resolves every module and provider', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.close();
  });
});
