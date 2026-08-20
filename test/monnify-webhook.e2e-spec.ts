import { All, Controller, Module, Post, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHmac } from 'node:crypto';
import { configureRawBody, isRawBodyRoute } from '../src/bootstrap/raw-body.bootstrap.js';
import { verifyMonnifySignature } from '../src/modules/webhooks/domain/monnify-signature.js';

const SECRET = 'e2e-secret';

@Controller()
class HarnessController {
  @Post('api/v1/webhooks/monnify/transaction-completion')
  webhook(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    const header = request.headers['monnify-signature'];
    const supplied = Array.isArray(header) ? header[0] : header;
    const raw = request.rawBody;
    if (!raw || !verifyMonnifySignature(raw, supplied, SECRET)) {
      void reply.code(401).send({ error: 'invalid signature' });
      return;
    }
    void reply.code(200).send({ received: true, parsed: request.body });
  }

  @All('api/v1/auth/login')
  login(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    void reply.send({ hasRawBody: Boolean(request.rawBody) });
  }
}

@Module({ controllers: [HarnessController] })
class HarnessModule {}

async function buildServer(): Promise<NestFastifyApplication> {
  // A real Nest application on the real Fastify adapter. A bare Fastify
  // instance would not register Nest's own JSON parser, and so would not
  // reproduce the FST_ERR_CTP_ALREADY_PRESENT collision that took the
  // deployed process down at boot.
  const app = await NestFactory.create<NestFastifyApplication>(
    HarnessModule,
    new FastifyAdapter({ bodyLimit: 1_048_576 }),
    { logger: false },
  );
  configureRawBody(app);
  // `init()` runs the parser registration that previously threw.
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * Exercises the raw-body parser and signature check over real HTTP.
 *
 * Unit tests verify each piece in isolation; only a real request proves they
 * compose — that Fastify hands the parser the unmodified bytes, that the
 * handler still receives a parsed object, and that scoping keeps other routes
 * untouched. This test caught malformed JSON being reported as 500 rather
 * than 400.
 *
 * No database is needed: the controller stands in for the real one, and the
 * parser and verifier under test are the production ones.
 */
describe('webhook over real HTTP', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await buildServer();
  });
  afterAll(async () => {
    await app.close();
  });

  // Deliberately awkward formatting: a re-serialized body would differ.
  const payload = '{"eventType":"SUCCESSFUL_TRANSACTION",  "eventData":{"amountPaid":"100.00"}}';

  it('accepts a genuine signed delivery', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/monnify/transaction-completion',
      headers: {
        'content-type': 'application/json',
        'monnify-signature': createHmac('sha512', SECRET).update(payload).digest('hex'),
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: true });
  });

  it('still parses the body into an object for the handler', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/monnify/transaction-completion',
      headers: {
        'content-type': 'application/json',
        'monnify-signature': createHmac('sha512', SECRET).update(payload).digest('hex'),
      },
      payload,
    });
    const body = res.json<{ parsed: unknown }>();
    expect(body.parsed).toEqual({
      eventType: 'SUCCESSFUL_TRANSACTION',
      eventData: { amountPaid: '100.00' },
    });
  });

  it('rejects a forged signature with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/monnify/transaction-completion',
      headers: { 'content-type': 'application/json', 'monnify-signature': 'f'.repeat(128) },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a body altered in flight', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/monnify/transaction-completion',
      headers: {
        'content-type': 'application/json',
        'monnify-signature': createHmac('sha512', SECRET).update(payload).digest('hex'),
      },
      payload: payload.replace('100.00', '999999.00'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('does not retain a raw body for non-webhook routes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":"a@b.c"}',
    });
    expect(res.json()).toEqual({ hasRawBody: false });
  });

  it('rejects malformed JSON without echoing the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/monnify/transaction-completion',
      headers: { 'content-type': 'application/json', 'monnify-signature': 'x' },
      payload: '{"secretValue":"leak-me",',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('leak-me');
  });

  it('scopes raw-body capture by path, not query string', () => {
    expect(isRawBodyRoute('/api/v1/auth/login?r=/webhooks/monnify')).toBe(false);
  });

  // Regression: the parser was registered with Fastify directly, so Nest then
  // tried to add a second `application/json` parser and the process died at
  // boot with FST_ERR_CTP_ALREADY_PRESENT. Booting a second app proves
  // registration is idempotent from Nest's point of view.
  it('boots without colliding with the parser Nest registers', async () => {
    const second = await buildServer();
    await second.close();
  });

  // Fastify's default parser refuses prototype-poisoning payloads; a bare
  // JSON.parse would accept them.
  it('rejects a prototype-poisoning payload', async () => {
    const poison = '{"__proto__":{"admin":true}}';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/monnify/transaction-completion',
      headers: {
        'content-type': 'application/json',
        'monnify-signature': createHmac('sha512', SECRET).update(poison).digest('hex'),
      },
      payload: poison,
    });
    expect(res.statusCode).toBe(400);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});
