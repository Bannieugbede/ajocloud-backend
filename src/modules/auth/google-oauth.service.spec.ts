import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleOAuthService } from './google-oauth.service.js';
import type { Environment } from '../../config/env.schema.js';

const ENV: Partial<Environment> = {
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALLBACK_URL: 'https://api.example.test/api/v1/auth/google/callback',
  GOOGLE_WEB_SUCCESS_URL: 'https://app.example.test/admin',
  GOOGLE_MOBILE_SUCCESS_URL: 'ajocloud://auth/google',
  TOKEN_PEPPER: 'pepper-value-at-least-32-characters-long',
};

function build(overrides: Partial<Environment> = {}) {
  const values = { ...ENV, ...overrides } as Record<string, unknown>;
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<Environment, true>;
  return new GoogleOAuthService({} as never, {} as never, config);
}

describe('GoogleOAuthService', () => {
  describe('configuration', () => {
    it('is disabled until every credential is present', () => {
      expect(build({ GOOGLE_CLIENT_ID: undefined }).enabled).toBe(false);
      expect(build().enabled).toBe(true);
    });

    it('refuses to start a sign-in when unconfigured', () => {
      expect(() => build({ GOOGLE_CLIENT_SECRET: undefined }).authorizationUrl('web')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('authorizationUrl', () => {
    it('requests only openid email profile and forces the account picker', () => {
      const url = new URL(build().authorizationUrl('web'));
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('prompt')).toBe('select_account');
      expect(url.searchParams.get('redirect_uri')).toBe(ENV.GOOGLE_CALLBACK_URL);
    });

    it('never leaks the client secret into the redirect', () => {
      expect(build().authorizationUrl('web')).not.toContain('client-secret');
    });
  });

  describe('state', () => {
    // The state parameter is the CSRF defence for the callback, so a forged or
    // altered value must never resolve to a client.
    const parseState = (service: GoogleOAuthService, client: 'web' | 'mobile') =>
      new URL(service.authorizationUrl(client)).searchParams.get('state') ?? '';

    it('round-trips the originating client', () => {
      const service = build();
      const verify = (state: string) =>
        (service as unknown as { verifyState(value: string): string }).verifyState(state);
      expect(verify(parseState(service, 'mobile'))).toBe('mobile');
      expect(verify(parseState(service, 'web'))).toBe('web');
    });

    it('rejects a tampered signature', () => {
      const service = build();
      const state = parseState(service, 'web');
      const forged = `${state.slice(0, -1)}${state.endsWith('a') ? 'b' : 'a'}`;
      expect(() =>
        (service as unknown as { verifyState(value: string): string }).verifyState(forged),
      ).toThrow(BadRequestException);
    });

    it('rejects a state signed with a different pepper', () => {
      const foreign = parseState(
        build({ TOKEN_PEPPER: 'another-pepper-32-characters-long!!' }),
        'web',
      );
      expect(() =>
        (build() as unknown as { verifyState(value: string): string }).verifyState(foreign),
      ).toThrow(BadRequestException);
    });

    it('rejects a malformed state', () => {
      expect(() =>
        (build() as unknown as { verifyState(value: string): string }).verifyState('nonsense'),
      ).toThrow(BadRequestException);
    });
  });

  describe('mobile handoff', () => {
    const tokens = { accessToken: 'a', refreshToken: 'r' } as never;

    it('redeems a code exactly once', () => {
      const service = build();
      const code = service.createHandoff(tokens);
      expect(service.redeemHandoff(code)).toBe(tokens);
      // Replaying the deep link must not yield a second session.
      expect(() => service.redeemHandoff(code)).toThrow(BadRequestException);
    });

    it('rejects an unknown code', () => {
      expect(() => build().redeemHandoff('never-issued')).toThrow(BadRequestException);
    });

    it('issues a distinct code per sign-in', () => {
      const service = build();
      expect(service.createHandoff(tokens)).not.toBe(service.createHandoff(tokens));
    });

    it('expires a code that was never redeemed', () => {
      const service = build();
      const code = service.createHandoff(tokens);
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60 * 1000);
      try {
        expect(() => service.redeemHandoff(code)).toThrow(BadRequestException);
      } finally {
        jest.spyOn(Date, 'now').mockRestore();
      }
    });
  });

  describe('successUrl', () => {
    it('sends each client to its own registered target', () => {
      expect(build().successUrl('web')).toBe(ENV.GOOGLE_WEB_SUCCESS_URL);
      expect(build().successUrl('mobile')).toBe(ENV.GOOGLE_MOBILE_SUCCESS_URL);
    });
  });
});
