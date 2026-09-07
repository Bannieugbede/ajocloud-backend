import type { FastifyRequest } from 'fastify';
import { wantsSessionCookies } from './session-cookie.js';

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
