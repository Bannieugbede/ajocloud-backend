import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { assertAllSwapApprovals, assertScheduleCanChange } from './ajo-policy.js';

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
});
