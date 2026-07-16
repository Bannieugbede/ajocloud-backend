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

  it('requires provider credentials only when that provider is selected', () => {
    expect(() => validateEnvironment({ ...valid, EMAIL_PROVIDER: 'brevo' })).toThrow(
      'BREVO_API_KEY is required for Brevo',
    );
    expect(() => validateEnvironment({ ...valid, BILL_PAYMENT_PROVIDER: 'monnify' })).toThrow(
      'MONNIFY_API_KEY is required for Monnify',
    );
    expect(() => validateEnvironment({ ...valid, KYC_PROVIDER: 'dojah' })).toThrow(
      'DOJAH_APP_ID is required for Dojah',
    );
  });

  it('fails fast for weak secrets', () => {
    expect(() => validateEnvironment({ ...valid, JWT_ACCESS_SECRET: 'weak' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
