import { createHash } from 'node:crypto';
import { extractMonnifyEvent, toMinorUnits, type MonnifyEventEnvelope } from './monnify-events.js';

const HASH = createHash('sha256').update('body').digest('hex');

describe('toMinorUnits', () => {
  it('converts a decimal string without floating-point arithmetic', () => {
    expect(toMinorUnits('100.00')).toBe(10_000n);
    expect(toMinorUnits('5000.55')).toBe(500_055n);
    expect(toMinorUnits('0.01')).toBe(1n);
  });

  it('converts values that lose precision as IEEE-754 doubles', () => {
    // 1155.57 * 100 === 115556.99999999999 in float arithmetic.
    expect(toMinorUnits('1155.57')).toBe(115_557n);
    expect(toMinorUnits('8.29')).toBe(829n);
  });

  it('handles a whole number and a single decimal place', () => {
    expect(toMinorUnits('250')).toBe(25_000n);
    expect(toMinorUnits('250.5')).toBe(25_050n);
  });

  it('accepts a numeric amount', () => {
    expect(toMinorUnits(1_000)).toBe(100_000n);
  });

  it('handles amounts beyond a safe integer', () => {
    expect(toMinorUnits('99999999999999.99')).toBe(9_999_999_999_999_999n);
  });

  it('rejects sub-minor precision rather than rounding money silently', () => {
    expect(toMinorUnits('10.005')).toBeNull();
  });

  it('keeps trailing zeros beyond two places', () => {
    expect(toMinorUnits('10.5000')).toBe(1_050n);
  });

  it('preserves a negative amount', () => {
    expect(toMinorUnits('-25.50')).toBe(-2_550n);
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const value of ['', 'abc', '1,000.00', '1e3', null, undefined, {}, '0x10', ' ']) {
      expect(toMinorUnits(value)).toBeNull();
    }
  });
});

describe('extractMonnifyEvent', () => {
  it('keys the event on the provider reference', () => {
    const event = extractMonnifyEvent(
      {
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: { transactionReference: 'MNFY|123', amountPaid: '500.00', currency: 'NGN' },
      },
      'TRANSACTION_COMPLETION',
      HASH,
    );

    expect(event.eventId).toBe('TRANSACTION_COMPLETION:MNFY|123');
    expect(event.amountMinor).toBe(50_000n);
    expect(event.currency).toBe('NGN');
    expect(event.routeMismatch).toBe(false);
  });

  it('falls back to the body hash so dedupe never degrades to nothing', () => {
    const event = extractMonnifyEvent(
      { eventType: 'SETTLEMENT', eventData: {} },
      'SETTLEMENT',
      HASH,
    );
    expect(event.eventId).toBe(`SETTLEMENT:sha256:${HASH}`);
  });

  it('flags an event delivered to the wrong route', () => {
    const event = extractMonnifyEvent(
      { eventType: 'SUCCESSFUL_DISBURSEMENT', eventData: { reference: 'D-1' } },
      'SETTLEMENT',
      HASH,
    );
    expect(event.routeMismatch).toBe(true);
  });

  it('does not flag an unrecognised event type as a mismatch', () => {
    const event = extractMonnifyEvent(
      { eventType: 'SOMETHING_NEW', eventData: {} },
      'SETTLEMENT',
      HASH,
    );
    expect(event.routeMismatch).toBe(false);
    expect(event.declaredType).toBe('SOMETHING_NEW');
  });

  it('survives a hostile or empty payload without throwing', () => {
    for (const payload of [
      {},
      { eventData: null },
      { eventData: 'not an object' },
      { eventData: [] },
      { eventType: 42, eventData: { amountPaid: {} } },
    ]) {
      const event = extractMonnifyEvent(payload, 'WALLET_ACTIVITY', HASH);
      expect(event.eventId).toBe(`WALLET_ACTIVITY:sha256:${HASH}`);
      expect(event.amountMinor).toBeNull();
    }
  });

  it('does not treat a prototype-polluting key as event data', () => {
    const event = extractMonnifyEvent(
      JSON.parse(
        '{"eventData":{"__proto__":{"polluted":true},"reference":"R-1"}}',
      ) as MonnifyEventEnvelope,
      'REFUND_COMPLETION',
      HASH,
    );
    expect(event.providerReference).toBe('R-1');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
