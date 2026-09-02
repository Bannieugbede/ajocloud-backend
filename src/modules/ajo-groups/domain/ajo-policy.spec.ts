import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  assertAllSwapApprovals,
  assertPayoutAllowsSwap,
  assertScheduleCanChange,
  assertSlotCapacity,
  assertSwapNotExpired,
  resolveMaxSlotsPerMember,
} from './ajo-policy.js';

describe('Ajo schedule policy', () => {
  it('rejects schedule changes after lock', () => {
    expect(() => assertScheduleCanChange('LOCKED')).toThrow(ConflictException);
  });

  it('requires every identified party to approve a swap', () => {
    expect(() =>
      assertAllSwapApprovals(
        ['source', 'target', 'admin'],
        [
          { approverId: 'source', decision: 'APPROVED' },
          { approverId: 'target', decision: 'APPROVED' },
        ],
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('accepts unanimous required approvals', () => {
    expect(() =>
      assertAllSwapApprovals(
        ['source', 'target'],
        [
          { approverId: 'source', decision: 'APPROVED' },
          { approverId: 'target', decision: 'APPROVED' },
        ],
      ),
    ).not.toThrow();
  });

  it('rejects an expired swap request', () => {
    expect(() =>
      assertSwapNotExpired(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')),
    ).toThrow(ConflictException);
  });

  it.each(['PROCESSING', 'PAID', 'FAILED', 'CANCELLED'])(
    'rejects a swap after payout status becomes %s',
    (status) => {
      expect(() => assertPayoutAllowsSwap(status)).toThrow(ConflictException);
    },
  );
});

describe('resolveMaxSlotsPerMember', () => {
  it('falls back to the group’s own capacity when omitted', () => {
    // A fixed default cannot work here: it must never exceed maxSlots, and any
    // constant will for some group.
    expect(resolveMaxSlotsPerMember(undefined, 6)).toBe(6);
  });

  it('keeps an explicit cap', () => {
    expect(resolveMaxSlotsPerMember(2, 6)).toBe(2);
  });
});

describe('assertSlotCapacity', () => {
  const valid = {
    minSlotsPerMember: 1,
    maxSlotsPerMember: 6,
    requestedSlots: 2,
    maxSlots: 6,
  };

  it('accepts a valid combination', () => {
    expect(() => assertSlotCapacity(valid)).not.toThrow();
  });

  it('refuses a per-member cap above the group’s capacity', () => {
    // This is the case the database rejected as an opaque 500: the DTO used to
    // default maxSlotsPerMember to 100, so every group with fewer than 100
    // slots failed unless the caller happened to set it.
    expect(() => assertSlotCapacity({ ...valid, maxSlotsPerMember: 100 })).toThrow(
      /cannot exceed the group/i,
    );
  });

  it('allows a per-member cap exactly equal to capacity', () => {
    expect(() => assertSlotCapacity({ ...valid, maxSlotsPerMember: 6 })).not.toThrow();
  });

  it('refuses a minimum above the maximum', () => {
    expect(() =>
      assertSlotCapacity({ ...valid, minSlotsPerMember: 4, maxSlotsPerMember: 2 }),
    ).toThrow(/Minimum slots cannot exceed/i);
  });

  it('refuses a request below the per-member minimum', () => {
    expect(() => assertSlotCapacity({ ...valid, minSlotsPerMember: 3, requestedSlots: 2 })).toThrow(
      /per-member limits/i,
    );
  });

  it('refuses a request above the per-member maximum', () => {
    expect(() => assertSlotCapacity({ ...valid, requestedSlots: 7 })).toThrow(/per-member limits/i);
  });

  it('refuses a request above total capacity', () => {
    expect(() =>
      assertSlotCapacity({ ...valid, maxSlots: 2, maxSlotsPerMember: 2, requestedSlots: 3 }),
    ).toThrow(/per-member limits|group capacity/i);
  });
});
