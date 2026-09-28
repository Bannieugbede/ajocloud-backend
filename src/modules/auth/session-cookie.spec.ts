import type { FastifyRequest } from 'fastify';
import { refreshTokenFrom, wantsSessionCookies } from './session-cookie.js';

const request = (headers: Record<string, string>): FastifyRequest =>
  ({ headers }) as unknown as FastifyRequest;

describe('wantsSessionCookies', () => {
  it('gives cookies to a browser, which identifies itself by Origin', () => {
    expect(wantsSessionCookies(request({ origin: 'https://console.ajo.cloud' }))).toBe(true);
  });

  it('withholds them from a native client, which sends no Origin', () => {
    // React Native's fetch stores Set-Cookie in a platform jar the app never
    // reads, so the refresh token would sit in plaintext storage and every
    // later write would carry two credentials at once.
    expect(wantsSessionCookies(request({ authorization: 'Bearer x' }))).toBe(false);
  });

  it('treats an empty Origin as no Origin', () => {
    expect(wantsSessionCookies(request({ origin: '' }))).toBe(false);
  });
});

describe('refreshTokenFrom', () => {
  const request = (refreshCookie?: string) =>
    ({
      headers: {},
      cookies: refreshCookie ? { ajo_refresh: refreshCookie } : {},
    }) as unknown as FastifyRequest;

  it('uses the token a native client posted, over a stale cookie in its jar', () => {
    // Preferring the cookie presented an already-rotated token, which the
    // server treats as theft and answers by revoking the session.
    expect(refreshTokenFrom(request('stale'), 'current')).toBe('current');
  });

  it('uses the cookie for a browser, which cannot post the token', () => {
    expect(refreshTokenFrom(request('browser'), undefined)).toBe('browser');
  });

  it('finds nothing when there is neither', () => {
    expect(refreshTokenFrom(request(), undefined)).toBeUndefined();
    expect(refreshTokenFrom(request(), '')).toBeUndefined();
  });
});
