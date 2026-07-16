import { UnprocessableEntityException } from '@nestjs/common';
import { assertAjoGroupBounds, generateRotationSchedule } from './ajo-schedule.js';

const dates = {
  startDate: new Date('2026-01-01T00:00:00Z'),
  endDate: new Date('2026-12-31T00:00:00Z'),
};

describe('Ajo rotation schedule', () => {
  it.each([3, 4])('reconciles the exact pool for %i odd/even slots', (count) => {
    const schedule = generateRotationSchedule({
      ...dates,
      frequency: 'WEEKLY',
      contributionAmountMinor: 12_345n,
      slots: Array.from({ length: count }, (_, index) => ({
        id: `slot-${index}`,
        position: index + 1,
      })),
    });
    expect(schedule).toHaveLength(count);
    expect(schedule.every((cycle) => cycle.payoutAmountMinor === 12_345n * BigInt(count))).toBe(
      true,
    );
  });

  it('supports multiple whole slots owned by the same member because scheduling is slot-based', () => {
    const schedule = generateRotationSchedule({
      ...dates,
      frequency: 'MONTHLY',
      contributionAmountMinor: 100_00n,
      slots: [
        { id: 'member-a-slot-1', position: 1 },
        { id: 'member-a-slot-2', position: 2 },
        { id: 'member-b-slot-1', position: 3 },
      ],
    });
    expect(schedule.map((cycle) => cycle.payoutSlotId)).toEqual([
      'member-a-slot-1',
      'member-a-slot-2',
      'member-b-slot-1',
    ]);
  });

  it('rejects more than 1,000 slots', () => {
    expect(() => assertAjoGroupBounds(dates.startDate, dates.endDate, 1_001)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects durations over 12 months', () => {
    expect(() =>
      assertAjoGroupBounds(dates.startDate, new Date('2027-01-02T00:00:00Z'), 10),
    ).toThrow(UnprocessableEntityException);
  });
});
