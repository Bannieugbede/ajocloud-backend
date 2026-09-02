import { UnprocessableEntityException } from '@nestjs/common';

/** One half-open markup band: `fromMinor <= amount < toMinor`. */
export interface FeeTier {
  readonly fromMinor: bigint;
  /** Null on the final, open-ended tier. */
  readonly toMinor: bigint | null;
  readonly amountMinor: bigint;
}

export interface VersionedFeeRule {
  readonly code: string;
  readonly version: number;
  readonly calculationType: 'FIXED' | 'PERCENTAGE' | 'TIERED';
  readonly amountMinor: bigint | null;
  readonly basisPoints: number | null;
  readonly minimumMinor: bigint | null;
  readonly maximumMinor: bigint | null;
  readonly payerType: string;
  readonly chargeEvent: string;
  /** The provider's own charge on this transaction, for TIERED pricing. */
  readonly providerRateBasisPoints?: number | null;
  readonly providerFlatMinor?: bigint | null;
  readonly tiers?: readonly FeeTier[];
}

/**
 * What the payment provider charges for a transaction of this size.
 *
 * Read from the definition rather than a constant: provider pricing is
 * unverified against official documentation (ADR-009), so it is versioned,
 * seeded configuration and every assessment snapshots the version that applied.
 */
export function providerCostMinor(rule: VersionedFeeRule, baseMinor: bigint): bigint {
  const proportional = (baseMinor * BigInt(rule.providerRateBasisPoints ?? 0)) / 10_000n;
  return proportional + (rule.providerFlatMinor ?? 0n);
}

/**
 * The markup band covering this amount.
 *
 * Bands are half-open, so a boundary amount belongs to exactly one tier and the
 * fee at a threshold is never ambiguous.
 */
export function tierFor(tiers: readonly FeeTier[], baseMinor: bigint): FeeTier | undefined {
  return tiers.find(
    (tier) => baseMinor >= tier.fromMinor && (tier.toMinor === null || baseMinor < tier.toMinor),
  );
}

/**
 * Rejects a tier set that does not partition its range.
 *
 * A gap would leave some amount with no fee and an overlap would make the fee
 * depend on row order, so both are refused before any money is assessed rather
 * than silently resolved.
 */
export function assertTiersPartitionRange(tiers: readonly FeeTier[]): void {
  if (tiers.length === 0) {
    throw new UnprocessableEntityException('A tiered fee needs at least one tier');
  }
  const ordered = [...tiers].sort((left, right) => (left.fromMinor < right.fromMinor ? -1 : 1));
  if (ordered[0]?.fromMinor !== 0n) {
    throw new UnprocessableEntityException('Fee tiers must start at zero');
  }
  for (const [index, tier] of ordered.entries()) {
    const next = ordered[index + 1];
    if (!next) {
      if (tier.toMinor !== null) {
        throw new UnprocessableEntityException('The final fee tier must be open ended');
      }
      break;
    }
    if (tier.toMinor === null) {
      throw new UnprocessableEntityException('Only the final fee tier may be open ended');
    }
    // Half-open bands abut exactly: one tier's end is the next tier's start.
    if (tier.toMinor !== next.fromMinor) {
      throw new UnprocessableEntityException(
        'Fee tiers must not overlap or leave a gap between bands',
      );
    }
    if (tier.amountMinor < 0n) {
      throw new UnprocessableEntityException('A fee tier cannot be negative');
    }
  }
}

export function assessVersionedFee(
  rule: VersionedFeeRule,
  baseMinor: bigint,
): {
  readonly amountMinor: bigint;
  readonly snapshot: Record<string, string | number | null>;
} {
  if (baseMinor < 0n) throw new UnprocessableEntityException('Fee base cannot be negative');
  let amountMinor: bigint;
  if (rule.calculationType === 'FIXED') {
    amountMinor = rule.amountMinor ?? 0n;
  } else if (rule.calculationType === 'PERCENTAGE') {
    amountMinor = percentageOf(baseMinor, rule.basisPoints);
  } else {
    // Cost-plus, floored at a percentage: the greater of the two means the
    // platform never sells below the provider's own cost, while margin still
    // scales with the amount rather than staying flat. See ADR-009.
    const tiers = rule.tiers ?? [];
    assertTiersPartitionRange(tiers);
    const tier = tierFor(tiers, baseMinor);
    if (!tier) {
      throw new UnprocessableEntityException('No fee tier covers this amount');
    }
    const costPlus = providerCostMinor(rule, baseMinor) + tier.amountMinor;
    const floor = percentageOf(baseMinor, rule.basisPoints);
    amountMinor = costPlus > floor ? costPlus : floor;
  }
  if (rule.minimumMinor !== null && amountMinor < rule.minimumMinor)
    amountMinor = rule.minimumMinor;
  if (rule.maximumMinor !== null && amountMinor > rule.maximumMinor)
    amountMinor = rule.maximumMinor;
  if (amountMinor < 0n) throw new UnprocessableEntityException('Fee cannot be negative');
  return {
    amountMinor,
    snapshot: {
      code: rule.code,
      version: rule.version,
      calculationType: rule.calculationType,
      amountMinor: rule.amountMinor?.toString() ?? null,
      basisPoints: rule.basisPoints,
      minimumMinor: rule.minimumMinor?.toString() ?? null,
      maximumMinor: rule.maximumMinor?.toString() ?? null,
      payerType: rule.payerType,
      chargeEvent: rule.chargeEvent,
      calculationBaseMinor: baseMinor.toString(),
      assessedAmountMinor: amountMinor.toString(),
      // Recorded so a charge can be explained later without re-reading the
      // definition, which may have been superseded by then.
      providerRateBasisPoints: rule.providerRateBasisPoints ?? null,
      providerFlatMinor: rule.providerFlatMinor?.toString() ?? null,
      providerCostMinor:
        rule.calculationType === 'TIERED' ? providerCostMinor(rule, baseMinor).toString() : null,
      tierMarkupMinor:
        rule.calculationType === 'TIERED'
          ? (tierFor(rule.tiers ?? [], baseMinor)?.amountMinor.toString() ?? null)
          : null,
    },
  };
}

/** Basis points of an amount, truncated. Kept in one place so the percentage
    floor and the PERCENTAGE type cannot drift apart. */
function percentageOf(baseMinor: bigint, basisPoints: number | null): bigint {
  return (baseMinor * BigInt(basisPoints ?? 0)) / 10_000n;
}
