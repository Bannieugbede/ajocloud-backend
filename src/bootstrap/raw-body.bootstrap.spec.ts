import { isRawBodyRoute } from './raw-body.bootstrap.js';

describe('isRawBodyRoute', () => {
  it('captures the raw body for webhook routes', () => {
    expect(isRawBodyRoute('/api/v1/webhooks/monnify/transaction-completion')).toBe(true);
    expect(isRawBodyRoute('/api/v1/webhooks/monnify/settlement?retry=2')).toBe(true);
  });

  it('leaves ordinary routes alone', () => {
    expect(isRawBodyRoute('/api/v1/auth/login')).toBe(false);
    expect(isRawBodyRoute('/api/v1/kyc/identity')).toBe(false);
  });

  it('does not let a query string widen the scope', () => {
    // Without stripping the query, this would retain a raw body for a route
    // that has no business holding one.
    expect(isRawBodyRoute('/api/v1/auth/login?next=/webhooks/monnify')).toBe(false);
  });
});
