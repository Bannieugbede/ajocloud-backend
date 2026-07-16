import { assessVersionedFee } from './fee-rule.js';

describe('versioned fee assessment', () => {
  it('calculates integer basis points and retains the producing rule snapshot', () => {
    const result = assessVersionedFee(
      {
        code: 'AJO_SWAP',
        version: 3,
        calculationType: 'PERCENTAGE',
        amountMinor: null,
        basisPoints: 250,
        minimumMinor: 100n,
        maximumMinor: 1_000n,
        payerType: 'REQUESTER',
        chargeEvent: 'SWAP_EXECUTED',
      },
      20_000n,
    );
    expect(result.amountMinor).toBe(500n);
    expect(result.snapshot).toMatchObject({
      code: 'AJO_SWAP',
      version: 3,
      calculationBaseMinor: '20000',
      assessedAmountMinor: '500',
    });
  });
});
