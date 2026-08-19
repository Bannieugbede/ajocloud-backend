import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Environment } from '../../config/env.schema.js';
import type { TokenPair } from './auth.service.js';

/** httpOnly — the browser sends it automatically; JS can never read it. */
export const ACCESS_COOKIE = 'ajo_access';
export const REFRESH_COOKIE = 'ajo_refresh';
/**
 * Readable by JS on purpose: the web client echoes it back in X-CSRF-Token so
 * the server can verify the caller could read the cookie (double-submit).
 */
export const CSRF_COOKIE = 'ajo_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Refresh is only ever sent to the endpoints that rotate or clear it. */
const REFRESH_PATH_SUFFIX = '/auth';

interface CookieOptions {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: 'none' | 'lax';
  readonly path: string;
  readonly maxAge?: number;
  readonly domain?: string;
}

/**
 * Cross-site cookies (web on one origin, API on another) require SameSite=None,
 * which browsers only accept together with Secure. Plain-HTTP localhost cannot
 * set such a cookie, so non-production falls back to Lax.
 */
export function sessionCookiePolicy(env: Environment): {
  crossSite: boolean;
  base: Omit<CookieOptions, 'maxAge' | 'httpOnly'>;
} {
  const crossSite = env.SESSION_COOKIE_SAMESITE_NONE;
  return {
    crossSite,
    base: {
      secure: crossSite || env.NODE_ENV === 'production',
      sameSite: crossSite ? 'none' : 'lax',
      path: '/',
      ...(env.SESSION_COOKIE_DOMAIN ? { domain: env.SESSION_COOKIE_DOMAIN } : {}),
    },
  };
}

function refreshPath(apiPrefix: string): string {
  return `/${apiPrefix}/v1${REFRESH_PATH_SUFFIX}`;
}

/** Writes the session cookie trio. `csrfToken` must be a fresh random value. */
export function setSessionCookies(
  reply: FastifyReply,
  tokens: TokenPair,
  csrfToken: string,
  env: Environment,
): void {
  const { base } = sessionCookiePolicy(env);
  const accessMaxAge = Math.max(
    1,
    Math.floor((Date.parse(tokens.accessTokenExpiresAt) - Date.now()) / 1_000),
  );
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    httpOnly: true,
    maxAge: accessMaxAge,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    httpOnly: true,
    path: refreshPath(env.API_PREFIX),
    maxAge: env.JWT_REFRESH_TTL_SECONDS,
  });
  // Not httpOnly: the browser client must read this one to echo it back.
  reply.setCookie(CSRF_COOKIE, csrfToken, {
    ...base,
    httpOnly: false,
    maxAge: env.JWT_REFRESH_TTL_SECONDS,
  });
}

export function clearSessionCookies(reply: FastifyReply, env: Environment): void {
  const { base } = sessionCookiePolicy(env);
  reply.clearCookie(ACCESS_COOKIE, { ...base });
  reply.clearCookie(REFRESH_COOKIE, { ...base, path: refreshPath(env.API_PREFIX) });
  reply.clearCookie(CSRF_COOKIE, { ...base });
}

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  return (request.cookies as Record<string, string | undefined> | undefined)?.[name];
}
