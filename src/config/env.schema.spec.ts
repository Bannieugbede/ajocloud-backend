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
    expect(() => validateEnvironment({ ...valid, KYC_PROVIDER: 'dojah' })).toThrow(
      'DOJAH_APP_ID is required for Dojah',
    );
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
