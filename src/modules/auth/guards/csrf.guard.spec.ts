import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard.js';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from '../session-cookie.js';

const context = (request: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as ExecutionContext;

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

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

  it('rejects a mismatched token', () => {
    const request = {
      method: 'POST',
      headers: { [CSRF_HEADER]: 'attacker' },
      cookies: { [ACCESS_COOKIE]: 'jwt', [CSRF_COOKIE]: 'token-value' },
    };
    expect(() => guard.canActivate(context(request))).toThrow(ForbiddenException);
  });
});
