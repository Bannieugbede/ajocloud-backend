import { UnprocessableEntityException } from '@nestjs/common';
import { reconcileFlexibleAjo } from './flexible-ajo.js';

describe('flexible Ajo whole-unit reconciliation', () => {
  it('reconciles different member unit quantities exactly', () => {
    const result = reconcileFlexibleAjo({
      contributionUnitMinor: 5_000_00n,
      cycleCount: 3,
      plans: [
        { memberId: 'a', unitQuantity: 1 },
        { memberId: 'b', unitQuantity: 2 },
      ],
      payouts: [
        { cycle: 1, unitCount: 3 },
        { cycle: 2, unitCount: 3 },
        { cycle: 3, unitCount: 3 },
      ],
    });
    expect(result.totalUnits).toBe(3);
    expect(result.expectedInflowMinor).toBe(result.expectedOutflowMinor);
  });

  it('rejects an insolvent schedule and hidden platform float', () => {
    expect(() =>
      reconcileFlexibleAjo({
        contributionUnitMinor: 1_000n,
        cycleCount: 2,
        plans: [
          { memberId: 'a', unitQuantity: 1 },
          { memberId: 'b', unitQuantity: 2 },
        ],
        payouts: [{ cycle: 1, unitCount: 7 }],
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects fractional or zero unit quantities', () => {
    expect(() =>
      reconcileFlexibleAjo({
        contributionUnitMinor: 1n,
        cycleCount: 1,
        plans: [
          { memberId: 'a', unitQuantity: 0.5 },
          { memberId: 'b', unitQuantity: 1 },
        ],
        payouts: [{ cycle: 1, unitCount: 2 }],
      }),
    ).toThrow(UnprocessableEntityException);
  });
});
