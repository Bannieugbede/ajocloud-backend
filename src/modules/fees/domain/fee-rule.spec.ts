import {
  assertTiersPartitionRange,
  assessVersionedFee,
  providerCostMinor,
  type VersionedFeeRule,
} from './fee-rule.js';

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

describe('tiered cost-plus fees (ADR-009)', () => {
  /** Deposit pricing: 2% floor, 1.5% provider rate, ₦50 markup below ₦10,000
      and ₦100 from ₦10,000. Figures are seeded configuration, not constants. */
  const deposits: VersionedFeeRule = {
    code: 'DEPOSIT',
    version: 1,
    calculationType: 'TIERED',
    amountMinor: null,
    basisPoints: 200,
    minimumMinor: null,
    maximumMinor: null,
    payerType: 'USER',
    chargeEvent: 'DEPOSIT',
    providerRateBasisPoints: 150,
    providerFlatMinor: 0n,
    tiers: [
      { fromMinor: 0n, toMinor: 1_000_000n, amountMinor: 5_000n },
      { fromMinor: 1_000_000n, toMinor: null, amountMinor: 10_000n },
    ],
  };

  it('prices a ₦1,000 deposit at ₦65 for ₦50 of margin', () => {
    const assessed = assessVersionedFee(deposits, 100_000n);
    expect(assessed.amountMinor).toBe(6_500n);
    expect(assessed.amountMinor - providerCostMinor(deposits, 100_000n)).toBe(5_000n);
  });

  it('prices a ₦15,000 deposit at ₦325 for ₦100 of margin', () => {
    const assessed = assessVersionedFee(deposits, 1_500_000n);
    expect(assessed.amountMinor).toBe(32_500n);
    expect(assessed.amountMinor - providerCostMinor(deposits, 1_500_000n)).toBe(10_000n);
  });

  it('never charges below the provider cost', () => {
    for (const naira of [100, 1_000, 9_999, 10_000, 50_000, 500_000]) {
      const base = BigInt(naira) * 100n;
      expect(assessVersionedFee(deposits, base).amountMinor).toBeGreaterThanOrEqual(
        providerCostMinor(deposits, base),
      );
    }
  });

  it('lets the percentage floor take over on large deposits', () => {
    // At ₦50,000 the 2% floor (₦1,000) exceeds cost-plus (₦850), so margin
    // scales with the amount instead of staying flat at the markup.
    const assessed = assessVersionedFee(deposits, 5_000_000n);
    expect(assessed.amountMinor).toBe(100_000n);
    expect(assessed.amountMinor - providerCostMinor(deposits, 5_000_000n)).toBe(25_000n);
  });

  it('puts a boundary amount in the upper band', () => {
    // ₦10,000 exactly: half-open bands make this the ₦100 markup, not ₦50.
    const atBoundary = assessVersionedFee(deposits, 1_000_000n);
    const justBelow = assessVersionedFee(deposits, 999_900n);
    expect(atBoundary.amountMinor - providerCostMinor(deposits, 1_000_000n)).toBe(10_000n);
    expect(justBelow.amountMinor - providerCostMinor(deposits, 999_900n)).toBe(5_000n);
  });

  it('snapshots what was charged and why', () => {
    const { snapshot } = assessVersionedFee(deposits, 1_500_000n);
    expect(snapshot).toEqual(
      expect.objectContaining({
        calculationType: 'TIERED',
        providerRateBasisPoints: 150,
        providerCostMinor: '22500',
        tierMarkupMinor: '10000',
        assessedAmountMinor: '32500',
      }),
    );
  });

  it('prices a payout as a flat provider cost plus ₦5', () => {
    const payouts: VersionedFeeRule = {
      ...deposits,
      code: 'PAYOUT',
      chargeEvent: 'PAYOUT',
      basisPoints: 0,
      providerRateBasisPoints: 0,
      providerFlatMinor: 2_000n,
      tiers: [{ fromMinor: 0n, toMinor: null, amountMinor: 500n }],
    };
    expect(assessVersionedFee(payouts, 1_000_000n).amountMinor).toBe(2_500n);
  });
});

describe('tier validation', () => {
  const tiers = (entries: { from: number; to: number | null; amount: number }[]) =>
    entries.map((entry) => ({
      fromMinor: BigInt(entry.from),
      toMinor: entry.to === null ? null : BigInt(entry.to),
      amountMinor: BigInt(entry.amount),
    }));

  it('accepts bands that abut exactly', () => {
    expect(() =>
      assertTiersPartitionRange(
        tiers([
          { from: 0, to: 1_000_000, amount: 5_000 },
          { from: 1_000_000, to: null, amount: 10_000 },
        ]),
      ),
    ).not.toThrow();
  });

  it('refuses a gap between bands', () => {
    // Some amount would have no fee at all.
    expect(() =>
      assertTiersPartitionRange(
        tiers([
          { from: 0, to: 1_000_000, amount: 5_000 },
          { from: 1_000_001, to: null, amount: 10_000 },
        ]),
      ),
    ).toThrow(/gap/i);
  });

  it('refuses overlapping bands', () => {
    // The fee would depend on row order.
    expect(() =>
      assertTiersPartitionRange(
        tiers([
          { from: 0, to: 1_000_000, amount: 5_000 },
          { from: 900_000, to: null, amount: 10_000 },
        ]),
      ),
    ).toThrow(/overlap/i);
  });

  it('requires the range to start at zero', () => {
    expect(() =>
      assertTiersPartitionRange(tiers([{ from: 100, to: null, amount: 5_000 }])),
    ).toThrow(/start at zero/i);
  });

  it('requires the last band to be open ended', () => {
    expect(() =>
      assertTiersPartitionRange(tiers([{ from: 0, to: 1_000_000, amount: 5_000 }])),
    ).toThrow(/open ended/i);
  });

  it('refuses an empty tier set rather than charging nothing', () => {
    expect(() => assertTiersPartitionRange([])).toThrow(/at least one tier/i);
  });

  it('is enforced during assessment, not merely available', () => {
    const broken: VersionedFeeRule = {
      code: 'DEPOSIT',
      version: 1,
      calculationType: 'TIERED',
      amountMinor: null,
      basisPoints: 200,
      minimumMinor: null,
      maximumMinor: null,
      payerType: 'USER',
      chargeEvent: 'DEPOSIT',
      providerRateBasisPoints: 150,
      providerFlatMinor: 0n,
      tiers: [{ fromMinor: 0n, toMinor: 1_000_000n, amountMinor: 5_000n }],
    };
    expect(() => assessVersionedFee(broken, 100_000n)).toThrow(/open ended/i);
  });
});
