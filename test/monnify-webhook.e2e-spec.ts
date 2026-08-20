import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { configureRawBody, isRawBodyRoute } from '../src/bootstrap/raw-body.bootstrap.js';
import { verifyMonnifySignature } from '../src/modules/webhooks/domain/monnify-signature.js';

const SECRET = 'e2e-secret';

async function buildServer() {
  const app = Fastify();
  // Exercise the real parser exactly as app.bootstrap.ts installs it.
  configureRawBody({ getHttpAdapter: () => ({ getInstance: () => app }) } as never);

  app.post('/api/v1/webhooks/monnify/transaction-completion', async (request, reply) => {
    const header = request.headers['monnify-signature'];
    const supplied = Array.isArray(header) ? header[0] : header;
    const raw = (request as { rawBody?: Buffer }).rawBody;
    if (!raw || !verifyMonnifySignature(raw, supplied, SECRET)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    return reply.code(200).send({ received: true, parsed: request.body });
  });

  app.post('/api/v1/auth/login', async (request, reply) =>
    reply.send({ hasRawBody: Boolean((request as { rawBody?: Buffer }).rawBody) }),
  );

  await app.ready();
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
 * No database is needed: the route stands in for the controller, and the
 * parser and verifier under test are the production ones.
 */
describe('webhook over real HTTP', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
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
});
