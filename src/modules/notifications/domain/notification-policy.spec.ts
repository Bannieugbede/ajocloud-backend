import { isWithinQuietHours, notificationDedupeKey } from './notification-policy.js';

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
