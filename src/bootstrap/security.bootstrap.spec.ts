import { createOriginPredicate } from './security.bootstrap.js';
import type { Environment } from '../config/env.schema.js';

const env = (overrides: Partial<Environment>): Environment =>
  ({
    NODE_ENV: 'development',
    CORS_ORIGINS: 'https://app.example.com',
    CORS_ALLOW_LOOPBACK: false,
    ...overrides,
  }) as Environment;

describe('CORS origin predicate', () => {
  it('allows exactly the configured origins', () => {
    const isAllowed = createOriginPredicate(env({ CORS_ORIGINS: 'https://a.com, https://b.com' }));
    expect(isAllowed('https://a.com')).toBe(true);
    expect(isAllowed('https://b.com')).toBe(true);
    expect(isAllowed('https://evil.com')).toBe(false);
  });

  it('rejects loopback on any port while the flag is off', () => {
    const isAllowed = createOriginPredicate(env({}));
    expect(isAllowed('http://localhost:3001')).toBe(false);
  });

  it('allows loopback on any port when enabled outside production', () => {
    const isAllowed = createOriginPredicate(env({ CORS_ALLOW_LOOPBACK: true }));
    for (const origin of [
      'http://localhost',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://127.0.0.1:5173',
      'https://localhost:8443',
    ])
      expect(isAllowed(origin)).toBe(true);
  });

  it('never allows loopback in production, even when the flag is set', () => {
    const isAllowed = createOriginPredicate(
      env({ CORS_ALLOW_LOOPBACK: true, NODE_ENV: 'production' }),
    );
    expect(isAllowed('http://localhost:3001')).toBe(false);
    expect(isAllowed('https://app.example.com')).toBe(true);
  });

  it('does not treat lookalike hosts as loopback', () => {
    const isAllowed = createOriginPredicate(env({ CORS_ALLOW_LOOPBACK: true }));
    expect(isAllowed('http://localhost.evil.com')).toBe(false);
    expect(isAllowed('http://notlocalhost')).toBe(false);
    expect(isAllowed('http://127.0.0.1.evil.com')).toBe(false);
  });
});
