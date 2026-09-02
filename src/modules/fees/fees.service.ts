import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionClient } from '../../infrastructure/database/transaction.service.js';
import { assessVersionedFee, type VersionedFeeRule } from './domain/fee-rule.js';

/** Fee codes the platform charges. Kept as a union so a typo cannot silently
    resolve to no definition and therefore no fee. */
export type FeeCode = 'DEPOSIT' | 'PAYOUT' | 'AJO_SWAP' | 'BILL_PAYMENT';

export interface AssessedFee {
  readonly amountMinor: bigint;
  readonly definitionId: string | null;
  readonly snapshot: Record<string, string | number | null>;
}

/**
 * Resolves and applies the platform's fee rules (ADR-009).
 *
 * Rates live in versioned `FeeDefinition` rows rather than in code, because the
 * provider pricing they mark up is unverified against official documentation:
 * correcting it must be a seeded change with an audit trail, not a code change.
 */
@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What to charge for a transaction of this size.
   *
   * A missing definition assesses zero rather than throwing. A fee that has not
   * been configured is a commercial gap, and refusing the payment would take
   * the product down over it; the zero is visible in the intent and the ledger,
   * so it cannot be silently forgotten.
   */
  async assess(
    code: FeeCode,
    baseMinor: bigint,
    client: PrismaService | TransactionClient = this.prisma,
  ): Promise<AssessedFee> {
    const definition = await this.activeDefinition(code, client);
    if (!definition) {
      return { amountMinor: 0n, definitionId: null, snapshot: { code, reason: 'NO_DEFINITION' } };
    }
    const assessed = assessVersionedFee(this.toRule(definition), baseMinor);
    return {
      amountMinor: assessed.amountMinor,
      definitionId: definition.id,
      snapshot: assessed.snapshot,
    };
  }

  /** The current version of a fee, honouring effective dating. */
  private async activeDefinition(code: FeeCode, client: PrismaService | TransactionClient) {
    const now = new Date();
    return client.feeDefinition.findFirst({
      where: {
        code,
        isActive: true,
        effectiveAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { version: 'desc' },
      include: { tiers: { orderBy: { fromMinor: 'asc' } } },
    });
  }

  private toRule(definition: {
    code: string;
    version: number;
    calculationType: string;
    amountMinor: bigint | null;
    basisPoints: number | null;
    minimumMinor: bigint | null;
    maximumMinor: bigint | null;
    payerType: string;
    chargeEvent: string;
    providerRateBasisPoints: number | null;
    providerFlatMinor: bigint | null;
    tiers: { fromMinor: bigint; toMinor: bigint | null; amountMinor: bigint }[];
  }): VersionedFeeRule {
    return {
      code: definition.code,
      version: definition.version,
      calculationType: definition.calculationType as VersionedFeeRule['calculationType'],
      amountMinor: definition.amountMinor,
      basisPoints: definition.basisPoints,
      minimumMinor: definition.minimumMinor,
      maximumMinor: definition.maximumMinor,
      payerType: definition.payerType,
      chargeEvent: definition.chargeEvent,
      providerRateBasisPoints: definition.providerRateBasisPoints,
      providerFlatMinor: definition.providerFlatMinor,
      tiers: definition.tiers,
    };
  }
}
