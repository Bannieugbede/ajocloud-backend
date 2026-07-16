import { UnprocessableEntityException } from '@nestjs/common';

export interface FlexibleContributionPlan {
  readonly memberId: string;
  readonly unitQuantity: number;
}

export interface FlexiblePayoutAllocation {
  readonly cycle: number;
  readonly unitCount: number;
}

export interface FlexibleAjoReconciliation {
  readonly contributionUnitMinor: bigint;
  readonly cycleCount: number;
  readonly totalUnits: number;
  readonly expectedInflowMinor: bigint;
  readonly expectedOutflowMinor: bigint;
}

export function reconcileFlexibleAjo(input: {
  readonly contributionUnitMinor: bigint;
  readonly cycleCount: number;
  readonly plans: readonly FlexibleContributionPlan[];
  readonly payouts: readonly FlexiblePayoutAllocation[];
}): FlexibleAjoReconciliation {
  if (input.contributionUnitMinor <= 0n) {
    throw new UnprocessableEntityException('Contribution unit must be positive');
  }
  if (!Number.isInteger(input.cycleCount) || input.cycleCount < 1) {
    throw new UnprocessableEntityException('Cycle count must be a positive integer');
  }
  if (input.plans.length < 2) {
    throw new UnprocessableEntityException('At least two members are required');
  }
  const members = new Set<string>();
  let totalUnits = 0;
  for (const plan of input.plans) {
    if (members.has(plan.memberId)) {
      throw new UnprocessableEntityException('Each member requires one contribution plan');
    }
    members.add(plan.memberId);
    if (!Number.isInteger(plan.unitQuantity) || plan.unitQuantity < 1) {
      throw new UnprocessableEntityException('Contribution units must be whole positive numbers');
    }
    totalUnits += plan.unitQuantity;
  }
  const scheduledUnits = input.payouts.reduce((sum, payout) => {
    if (
      !Number.isInteger(payout.cycle) ||
      payout.cycle < 1 ||
      payout.cycle > input.cycleCount ||
      !Number.isInteger(payout.unitCount) ||
      payout.unitCount < 1
    ) {
      throw new UnprocessableEntityException('Payout allocations must use valid whole units');
    }
    return sum + payout.unitCount;
  }, 0);
  const expectedInflowMinor =
    input.contributionUnitMinor * BigInt(totalUnits) * BigInt(input.cycleCount);
  const expectedOutflowMinor = input.contributionUnitMinor * BigInt(scheduledUnits);
  if (
    scheduledUnits !== totalUnits * input.cycleCount ||
    expectedInflowMinor !== expectedOutflowMinor
  ) {
    throw new UnprocessableEntityException(
      'Flexible Ajo schedule does not reconcile without platform liquidity',
    );
  }
  return {
    contributionUnitMinor: input.contributionUnitMinor,
    cycleCount: input.cycleCount,
    totalUnits,
    expectedInflowMinor,
    expectedOutflowMinor,
  };
}
