import { UnprocessableEntityException } from '@nestjs/common';
import { assertBalancedPosting } from './ledger-invariants.js';

describe('ledger invariants', () => {
  const base = {
    idempotencyKey: 'key',
    reference: 'LEDGER-1',
    description: 'test',
    currency: 'NGN',
  } as const;

  it('accepts exact balanced integer-minor-unit entries', () => {
    expect(() =>
      assertBalancedPosting({
        ...base,
        entries: [
          { accountId: 'asset', direction: 'DEBIT', amountMinor: 10_001n },
          { accountId: 'liability', direction: 'CREDIT', amountMinor: 10_001n },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects an unbalanced posting', () => {
    expect(() =>
      assertBalancedPosting({
        ...base,
        entries: [
          { accountId: 'asset', direction: 'DEBIT', amountMinor: 100n },
          { accountId: 'liability', direction: 'CREDIT', amountMinor: 99n },
        ],
      }),
    ).toThrow(UnprocessableEntityException);
  });
});
