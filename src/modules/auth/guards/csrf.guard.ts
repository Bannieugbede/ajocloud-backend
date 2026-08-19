import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, readCookie } from '../session-cookie.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Double-submit CSRF check for cookie-authenticated requests.
 *
 * Bearer callers (mobile) are exempt: an attacker's page cannot set an
 * Authorization header cross-origin, so those requests are not forgeable the
 * way ambient cookies are.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    // No session cookie means this cannot be an ambient-credential request.
    if (!readCookie(request, ACCESS_COOKIE)) return true;

    const cookieToken = readCookie(request, CSRF_COOKIE);
    const headerValue = request.headers[CSRF_HEADER];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken))
      throw new ForbiddenException('Invalid CSRF token');
    return true;
  }
}
