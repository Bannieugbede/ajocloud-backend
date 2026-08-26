import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard.js';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from '../session-cookie.js';

const context = (request: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

/** A Reflector that reports every route as public, or none of them. */
const reflector = (isPublic: boolean): Reflector =>
  ({ getAllAndOverride: () => isPublic }) as unknown as Reflector;

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(reflector(false));

  it('allows safe methods without a token', () => {
    expect(guard.canActivate(context({ method: 'GET', headers: {}, cookies: {} }))).toBe(true);
  });

  it('allows Bearer callers with no session cookie', () => {
    const request = { method: 'POST', headers: { authorization: 'Bearer x' }, cookies: {} };
    expect(guard.canActivate(context(request))).toBe(true);
  });

  it('accepts a matching double-submit token', () => {
    const request = {
      method: 'POST',
      headers: { [CSRF_HEADER]: 'token-value' },
      cookies: { [ACCESS_COOKIE]: 'jwt', [CSRF_COOKIE]: 'token-value' },
    };
    expect(guard.canActivate(context(request))).toBe(true);
  });

  it('rejects a cookie-authenticated write with no CSRF header', () => {
    const request = {
      method: 'POST',
      headers: {},
      cookies: { [ACCESS_COOKIE]: 'jwt', [CSRF_COOKIE]: 'token-value' },
    };
    expect(() => guard.canActivate(context(request))).toThrow(ForbiddenException);
  });

  it('lets a provider webhook through, since it carries no session cookie', () => {
    // Webhooks are POSTs from a server with no cookies. If this guard blocked
    // them they would fail after passing signature verification. ADR-006 states
    // this exemption holds; this test is why it is not merely an assumption.
    const request = {
      method: 'POST',
      headers: { 'monnify-signature': 'a'.repeat(128) },
      cookies: {},
    };
    expect(guard.canActivate(context(request))).toBe(true);
  });

  it('exempts a @PublicEndpoint() route from the check', () => {
    // A visitor signed in elsewhere on the domain carries the session cookie on
    // a public form post that never reads it. Without this exemption the
    // waitlist rejects exactly the people who already have an account.
    const publicGuard = new CsrfGuard(reflector(true));
    const request = {
      method: 'POST',
      headers: {},
      cookies: { [ACCESS_COOKIE]: 'jwt', [CSRF_COOKIE]: 'token-value' },
    };
    expect(publicGuard.canActivate(context(request))).toBe(true);
  });

  it('rejects a mismatched token', () => {
    const request = {
      method: 'POST',
      headers: { [CSRF_HEADER]: 'attacker' },
      cookies: { [ACCESS_COOKIE]: 'jwt', [CSRF_COOKIE]: 'token-value' },
    };
    expect(() => guard.canActivate(context(request))).toThrow(ForbiddenException);
  });
});
