import { UnprocessableEntityException } from '@nestjs/common';

export interface VersionedFeeRule {
  readonly code: string;
  readonly version: number;
  readonly calculationType: 'FIXED' | 'PERCENTAGE';
  readonly amountMinor: bigint | null;
  readonly basisPoints: number | null;
  readonly minimumMinor: bigint | null;
  readonly maximumMinor: bigint | null;
  readonly payerType: string;
  readonly chargeEvent: string;
}

export function assessVersionedFee(
  rule: VersionedFeeRule,
  baseMinor: bigint,
): {
  readonly amountMinor: bigint;
  readonly snapshot: Record<string, string | number | null>;
} {
  if (baseMinor < 0n) throw new UnprocessableEntityException('Fee base cannot be negative');
  let amountMinor =
    rule.calculationType === 'FIXED'
      ? (rule.amountMinor ?? 0n)
      : (baseMinor * BigInt(rule.basisPoints ?? 0)) / 10_000n;
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
    },
  };
}
