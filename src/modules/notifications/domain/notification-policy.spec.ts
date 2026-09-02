import {
  decideDelivery,
  isValidQuietHours,
  isWithinQuietHours,
  localMinuteOfDay,
  notificationDedupeKey,
} from './notification-policy.js';

describe('notification policy', () => {
  it('handles quiet hours that cross midnight', () => {
    expect(
      isWithinQuietHours({ localMinuteOfDay: 23 * 60, startMinute: 22 * 60, endMinute: 7 * 60 }),
    ).toBe(true);
    expect(
      isWithinQuietHours({ localMinuteOfDay: 12 * 60, startMinute: 22 * 60, endMinute: 7 * 60 }),
    ).toBe(false);
  });

  it('creates deterministic reminder dedupe keys', () => {
    expect(notificationDedupeKey('user', 'ajo.due', 'cycle', '2026-01-01T00:00:00Z')).toBe(
      notificationDedupeKey('user', 'ajo.due', 'cycle', '2026-01-01T00:00:00Z'),
    );
  });
});

describe('localMinuteOfDay', () => {
  it('reads the hour in the user timezone, not the server one', () => {
    // 23:30 UTC is 00:30 the next day in Lagos (UTC+1).
    const at = new Date('2026-09-02T23:30:00.000Z');
    expect(localMinuteOfDay(at, 'Africa/Lagos')).toBe(30);
    expect(localMinuteOfDay(at, 'UTC')).toBe(23 * 60 + 30);
  });

  it('treats midnight as minute zero', () => {
    expect(localMinuteOfDay(new Date('2026-09-02T00:00:00.000Z'), 'UTC')).toBe(0);
  });
});

describe('decideDelivery', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');
  const quiet = {
    enabled: true,
    quietHoursStartMinutes: 22 * 60,
    quietHoursEndMinutes: 7 * 60,
    timezone: 'UTC',
  };

  it('always sends a template with no topic, even when a preference says otherwise', () => {
    expect(
      decideDelivery({
        topic: null,
        preference: { ...quiet, enabled: false },
        now: new Date('2026-09-02T23:00:00.000Z'),
      }),
    ).toEqual({ send: true });
  });

  it('sends when the user has expressed no preference', () => {
    expect(decideDelivery({ topic: 'ajo.payout', preference: null, now })).toEqual({ send: true });
    expect(decideDelivery({ topic: 'ajo.payout', now })).toEqual({ send: true });
  });

  it('suppresses a topic the user switched off', () => {
    expect(
      decideDelivery({ topic: 'ajo.payout', preference: { ...quiet, enabled: false }, now }),
    ).toEqual({ send: false, reason: 'DISABLED' });
  });

  it('holds a product message inside quiet hours', () => {
    expect(
      decideDelivery({
        topic: 'ajo.payout',
        preference: quiet,
        now: new Date('2026-09-02T23:00:00.000Z'),
      }),
    ).toEqual({ send: false, reason: 'QUIET_HOURS' });
  });

  it('sends outside quiet hours', () => {
    expect(decideDelivery({ topic: 'ajo.payout', preference: quiet, now })).toEqual({ send: true });
  });

  it('evaluates quiet hours against the user timezone', () => {
    // 22:30 UTC is 23:30 in Lagos, inside 22:00-07:00 there but not in UTC-only
    // terms for a user whose window is expressed in their own zone.
    const at = new Date('2026-09-02T21:30:00.000Z');
    expect(
      decideDelivery({ topic: 'ajo.payout', preference: { ...quiet, timezone: 'UTC' }, now: at }),
    ).toEqual({ send: true });
    expect(
      decideDelivery({
        topic: 'ajo.payout',
        preference: { ...quiet, timezone: 'Africa/Lagos' },
        now: at,
      }),
    ).toEqual({ send: false, reason: 'QUIET_HOURS' });
  });

  it('ignores a half-configured quiet window', () => {
    expect(
      decideDelivery({
        topic: 'ajo.payout',
        preference: { ...quiet, quietHoursEndMinutes: null },
        now: new Date('2026-09-02T23:00:00.000Z'),
      }),
    ).toEqual({ send: true });
  });
});

describe('isValidQuietHours', () => {
  it('accepts both unset', () => {
    expect(isValidQuietHours(null, null)).toBe(true);
    expect(isValidQuietHours(undefined, undefined)).toBe(true);
  });

  it('refuses only one end of the window', () => {
    expect(isValidQuietHours(22 * 60, null)).toBe(false);
    expect(isValidQuietHours(null, 7 * 60)).toBe(false);
  });

  it('refuses a minute outside the day', () => {
    expect(isValidQuietHours(-1, 60)).toBe(false);
    expect(isValidQuietHours(0, 24 * 60)).toBe(false);
    expect(isValidQuietHours(1.5, 60)).toBe(false);
  });

  it('accepts a window that crosses midnight', () => {
    expect(isValidQuietHours(22 * 60, 7 * 60)).toBe(true);
  });
});
