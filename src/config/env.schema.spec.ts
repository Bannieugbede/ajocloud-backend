import { validateEnvironment } from './env.schema.js';

const valid = {
  NODE_ENV: 'test',
  CORS_ORIGINS: 'http://localhost',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://test:test@localhost:5672',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  TOKEN_PEPPER: 'b'.repeat(32),
};

describe('environment validation', () => {
  describe('GOOGLE_MOBILE_SUCCESS_URL', () => {
    // A double-slashed deep link does not error at runtime: Android's auth
    // session compares redirects with startsWith, so the browser simply never
    // returns and sign-in hangs. It has to be caught at boot.
    it('rejects a double-slashed deep link', () => {
      expect(() =>
        validateEnvironment({ ...valid, GOOGLE_MOBILE_SUCCESS_URL: 'ajocloud://auth/google' }),
      ).toThrow(/triple-slashed/);
    });

    it('accepts the triple-slashed form the mobile app builds', () => {
      const environment = validateEnvironment({
        ...valid,
        GOOGLE_MOBILE_SUCCESS_URL: 'ajocloud:///auth/google',
      });
      expect(environment.GOOGLE_MOBILE_SUCCESS_URL).toBe('ajocloud:///auth/google');
    });

    it('still treats a blank value as unset, which disables Google sign-in', () => {
      const environment = validateEnvironment({ ...valid, GOOGLE_MOBILE_SUCCESS_URL: '' });
      expect(environment.GOOGLE_MOBILE_SUCCESS_URL).toBeUndefined();
    });
  });

  it('coerces safe defaults and typed values', () => {
    const environment = validateEnvironment(valid);
    expect(environment.PORT).toBe(3000);
    expect(environment.SWAGGER_ENABLED).toBe(true);
    expect(environment.EMAIL_PROVIDER).toBe('console');
  });

  it('treats blank cookie/CORS values as unset (deployment UIs pass empty strings)', () => {
    const environment = validateEnvironment({
      ...valid,
      CORS_ALLOW_LOOPBACK: '',
      SESSION_COOKIE_SAMESITE_NONE: '',
      SESSION_COOKIE_DOMAIN: '',
      COOKIE_SECRET: '',
    });
    expect(environment.CORS_ALLOW_LOOPBACK).toBe(false);
    expect(environment.SESSION_COOKIE_SAMESITE_NONE).toBe(false);
    expect(environment.SESSION_COOKIE_DOMAIN).toBeUndefined();
    expect(environment.COOKIE_SECRET).toBeUndefined();
  });

  it('still rejects a cookie secret that is present but too short', () => {
    expect(() => validateEnvironment({ ...valid, COOKIE_SECRET: 'tooshort' })).toThrow(
      'COOKIE_SECRET',
    );
  });

  it('requires provider credentials only when that provider is selected', () => {
    expect(() => validateEnvironment({ ...valid, EMAIL_PROVIDER: 'resend' })).toThrow(
      'RESEND_API_KEY is required for Resend',
    );
    expect(() => validateEnvironment({ ...valid, BILL_PAYMENT_PROVIDER: 'monnify' })).toThrow(
      'MONNIFY_API_KEY is required for Monnify',
    );
    expect(() => validateEnvironment({ ...valid, KYC_PROVIDER: 'monnify' })).toThrow(
      'MONNIFY_API_KEY is required for Monnify KYC',
    );
  });

  it('refuses to enable webhooks without a signing secret', () => {
    expect(() => validateEnvironment({ ...valid, MONNIFY_WEBHOOKS_ENABLED: 'true' })).toThrow(
      'MONNIFY_WEBHOOK_SECRET is required when MONNIFY_WEBHOOKS_ENABLED is true',
    );
    expect(() =>
      validateEnvironment({
        ...valid,
        MONNIFY_WEBHOOKS_ENABLED: 'true',
        MONNIFY_WEBHOOK_SECRET: 'signing-secret',
      }),
    ).not.toThrow();
  });

  it('refuses the sandbox KYC fallback in production', () => {
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'production', KYC_SANDBOX_FALLBACK: 'true' }),
    ).toThrow('KYC_SANDBOX_FALLBACK must not be enabled in production');
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'development', KYC_SANDBOX_FALLBACK: 'true' }),
    ).not.toThrow();
  });

  it('leaves webhooks and the sandbox fallback disabled by default', () => {
    const environment = validateEnvironment({ ...valid });
    expect(environment.MONNIFY_WEBHOOKS_ENABLED).toBe(false);
    expect(environment.KYC_SANDBOX_FALLBACK).toBe(false);
  });

  it('accepts blank optional provider values for disabled integrations', () => {
    expect(
      validateEnvironment({
        ...valid,
        RESEND_BASE_URL: '',
        RESEND_SENDER_EMAIL: '',
        MONNIFY_BASE_URL: '',
      }),
    ).toMatchObject({
      RESEND_BASE_URL: '',
      RESEND_SENDER_EMAIL: '',
      MONNIFY_BASE_URL: '',
    });
  });

  it('fails fast for weak secrets', () => {
    expect(() => validateEnvironment({ ...valid, JWT_ACCESS_SECRET: 'weak' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
