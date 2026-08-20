import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Environment } from '../../../config/env.schema.js';
import { MonnifySignatureGuard } from './monnify-signature.guard.js';

const SECRET = 'webhook-secret';
const BODY = Buffer.from('{"eventType":"SUCCESSFUL_TRANSACTION"}');

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

function buildConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    MONNIFY_WEBHOOKS_ENABLED: true,
    MONNIFY_WEBHOOK_SECRET: SECRET,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Environment, true>;
}

function buildContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function requestWith(overrides: Record<string, unknown> = {}) {
  return {
    url: '/api/v1/webhooks/monnify/transaction-completion',
    rawBody: BODY,
    headers: { 'monnify-signature': sign(BODY) },
    ...overrides,
  };
}

describe('MonnifySignatureGuard', () => {
  it('admits a correctly signed delivery', () => {
    const guard = new MonnifySignatureGuard(buildConfig());
    expect(guard.canActivate(buildContext(requestWith()))).toBe(true);
  });

  it('rejects a forged signature', () => {
    const guard = new MonnifySignatureGuard(buildConfig());
    const context = buildContext(
      requestWith({ headers: { 'monnify-signature': sign(BODY, 'attacker-secret') } }),
    );
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a delivery with no signature header', () => {
    const guard = new MonnifySignatureGuard(buildConfig());
    expect(() => guard.canActivate(buildContext(requestWith({ headers: {} })))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a body that was tampered with after signing', () => {
    const guard = new MonnifySignatureGuard(buildConfig());
    const context = buildContext(requestWith({ rawBody: Buffer.from('{"eventType":"FORGED"}') }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('refuses when the raw body was not captured, rather than trusting the parsed body', () => {
    const guard = new MonnifySignatureGuard(buildConfig());
    const context = buildContext(requestWith({ rawBody: undefined }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('fails closed when webhooks are disabled', () => {
    const guard = new MonnifySignatureGuard(buildConfig({ MONNIFY_WEBHOOKS_ENABLED: false }));
    expect(() => guard.canActivate(buildContext(requestWith()))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails closed when no secret is configured, never accepting unverified traffic', () => {
    const guard = new MonnifySignatureGuard(buildConfig({ MONNIFY_WEBHOOK_SECRET: '' }));
    expect(() => guard.canActivate(buildContext(requestWith()))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('uses the first value when the signature header is repeated', () => {
    const guard = new MonnifySignatureGuard(buildConfig());
    const context = buildContext(
      requestWith({ headers: { 'monnify-signature': [sign(BODY), 'junk'] } }),
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('does not leak the payload or the expected signature in its error', () => {
    const guard = new MonnifySignatureGuard(buildConfig());
    const context = buildContext(requestWith({ headers: { 'monnify-signature': 'bad' } }));
    try {
      guard.canActivate(context);
      throw new Error('expected a rejection');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe('Invalid webhook signature');
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(sign(BODY));
    }
  });
});
