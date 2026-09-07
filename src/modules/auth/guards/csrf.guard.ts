import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { PUBLIC_ENDPOINT_KEY } from '../../../common/decorators/public-endpoint.decorator.js';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, readCookie } from '../session-cookie.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Whether the request carries an explicit Bearer credential.
 *
 * The scheme must be well formed. Any header at all would otherwise be an
 * opt-out of this check, and a cross-origin caller is free to send junk.
 */
function hasBearerCredential(request: FastifyRequest): boolean {
  const authorization = request.headers.authorization;
  return typeof authorization === 'string' && authorization.startsWith('Bearer ');
}

/**
 * Double-submit CSRF check for cookie-authenticated requests.
 *
 * Bearer callers (mobile) are exempt: an attacker's page cannot set an
 * Authorization header cross-origin without a preflight this API answers on
 * its own terms, whereas a form post — the thing CSRF actually is — cannot set
 * headers at all. Routes marked `@PublicEndpoint()` are exempt too: they never
 * read the session cookie, so a visitor signed in elsewhere on the domain must
 * not be blocked from a public form.
 *
 * The exemption is decided by the credential, not by the absence of a cookie.
 * Mobile signs in through the same endpoints the browser uses, so the API sets
 * the session cookie trio on that response and React Native's fetch stores it
 * in the platform cookie jar unbidden. Judging by the cookie alone therefore
 * refused every mobile write with "Invalid CSRF token" — a client that cannot
 * read a cookie back was being asked to echo one. AccessTokenGuard prefers the
 * Bearer token when both are present; this guard now agrees with it, which is
 * the property that matters: the credential being verified is the credential
 * being protected.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    // An explicit Bearer token is what AccessTokenGuard will authenticate, so
    // any cookie riding along is not the credential under attack.
    if (hasBearerCredential(request)) return true;
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
