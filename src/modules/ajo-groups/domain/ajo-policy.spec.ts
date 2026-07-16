import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  assertAllSwapApprovals,
  assertPayoutAllowsSwap,
  assertScheduleCanChange,
  assertSwapNotExpired,
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
