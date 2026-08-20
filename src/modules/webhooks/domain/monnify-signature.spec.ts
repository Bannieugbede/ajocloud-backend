import { createHmac } from 'node:crypto';
import {
  computeMonnifySignature,
  isWithinTimestampTolerance,
  verifyMonnifySignature,
  WEBHOOK_TIMESTAMP_TOLERANCE_MS,
} from './monnify-signature.js';

const SECRET = 'test-webhook-secret';
const BODY = Buffer.from(
  '{"eventType":"SUCCESSFUL_TRANSACTION","eventData":{"amountPaid":"100.00"}}',
);

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

describe('verifyMonnifySignature', () => {
  it('accepts a signature over the exact raw body', () => {
    expect(verifyMonnifySignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('accepts an upper-case digest', () => {
    expect(verifyMonnifySignature(BODY, sign(BODY).toUpperCase(), SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyMonnifySignature(BODY, sign(BODY, 'other-secret'), SECRET)).toBe(false);
  });

  it('rejects when a single byte of the body changed', () => {
    const signature = sign(BODY);
    const tampered = Buffer.from(BODY.toString().replace('100.00', '900.00'));
    expect(verifyMonnifySignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a re-serialized body, proving raw bytes are required', () => {
    // Same JSON value, different bytes: this is what would be compared if the
    // parsed object were re-stringified instead of using the raw buffer.
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(BODY.toString())));
    const reordered = Buffer.from(
      '{"eventData":{"amountPaid":"100.00"},"eventType":"SUCCESSFUL_TRANSACTION"}',
    );
    expect(reserialized.equals(BODY)).toBe(true);
    expect(verifyMonnifySignature(reordered, sign(BODY), SECRET)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifyMonnifySignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyMonnifySignature(BODY, '', SECRET)).toBe(false);
  });

  it('rejects when no secret is configured, never treating that as a pass', () => {
    expect(verifyMonnifySignature(BODY, sign(BODY), '')).toBe(false);
  });

  it('rejects a truncated signature without throwing', () => {
    expect(verifyMonnifySignature(BODY, sign(BODY).slice(0, 40), SECRET)).toBe(false);
  });

  it('rejects a non-hex signature of the correct length', () => {
    expect(verifyMonnifySignature(BODY, 'z'.repeat(128), SECRET)).toBe(false);
  });

  it('produces a 128-character hex digest', () => {
    expect(computeMonnifySignature(BODY, SECRET)).toMatch(/^[0-9a-f]{128}$/);
  });

  it('verifies an empty body rather than crashing', () => {
    const empty = Buffer.alloc(0);
    expect(verifyMonnifySignature(empty, sign(empty), SECRET)).toBe(true);
  });
});

describe('isWithinTimestampTolerance', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');

  it('accepts a recent timestamp', () => {
    expect(isWithinTimestampTolerance('2026-08-20T11:58:00.000Z', now)).toBe(true);
  });

  it('rejects a replayed timestamp beyond tolerance', () => {
    expect(isWithinTimestampTolerance('2026-08-20T11:00:00.000Z', now)).toBe(false);
  });

  it('rejects a timestamp too far in the future', () => {
    expect(isWithinTimestampTolerance('2026-08-20T13:00:00.000Z', now)).toBe(false);
  });

  it('tolerates small forward clock skew', () => {
    const skewed = new Date(now + WEBHOOK_TIMESTAMP_TOLERANCE_MS - 1_000).toISOString();
    expect(isWithinTimestampTolerance(skewed, now)).toBe(true);
  });

  it('accepts a missing or unparseable timestamp, since dedupe is the real guard', () => {
    expect(isWithinTimestampTolerance(undefined, now)).toBe(true);
    expect(isWithinTimestampTolerance('not a date', now)).toBe(true);
  });
});
