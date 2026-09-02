import type { PrismaClient } from '../../../generated/prisma/client.js';

/**
 * Platform fee definitions (ADR-009).
 *
 * Deposits are cost-plus with a tiered markup, floored at a percentage, so the
 * platform never sells below the provider's own charge and margin still scales
 * with the amount. Payouts are a flat provider cost plus a small markup,
 * because outbound transfer pricing is per transaction rather than proportional.
 *
 * The provider figures below are commercial modelling assumptions and are NOT
 * verified against Monnify's official documentation or the commercial
 * agreement. They live here, versioned and effective-dated, precisely so that
 * correcting them is a seed change with an audit trail rather than a code
 * change — and every `FeeAssessment` snapshots the version that applied to it.
 */

const NAIRA = 100n;

export async function seedFees(prisma: PrismaClient): Promise<void> {
  await upsertTiered(prisma, {
    code: 'DEPOSIT',
    name: 'Wallet deposit fee',
    chargeEvent: 'DEPOSIT_SETTLED',
    // 2% floor: what earns on large deposits, where a flat markup would not.
    basisPoints: 200,
    providerRateBasisPoints: 150,
    providerFlatMinor: 0n,
    tiers: [
      // Half-open bands: ₦10,000 exactly pays the upper markup.
      { fromMinor: 0n, toMinor: 10_000n * NAIRA, amountMinor: 50n * NAIRA },
      { fromMinor: 10_000n * NAIRA, toMinor: null, amountMinor: 100n * NAIRA },
    ],
  });

  await upsertTiered(prisma, {
    code: 'PAYOUT',
    name: 'Payout transfer fee',
    chargeEvent: 'PAYOUT_SENT',
    // No percentage floor: an outbound transfer costs the same whatever it
    // carries, so charging a percentage would misprice it in both directions.
    basisPoints: 0,
    providerRateBasisPoints: 0,
    providerFlatMinor: 20n * NAIRA,
    tiers: [{ fromMinor: 0n, toMinor: null, amountMinor: 5n * NAIRA }],
  });
}

async function upsertTiered(
  prisma: PrismaClient,
  input: {
    code: string;
    name: string;
    chargeEvent: string;
    basisPoints: number;
    providerRateBasisPoints: number;
    providerFlatMinor: bigint;
    tiers: { fromMinor: bigint; toMinor: bigint | null; amountMinor: bigint }[];
  },
): Promise<void> {
  const definition = await prisma.feeDefinition.upsert({
    where: { code_version: { code: input.code, version: 1 } },
    update: {
      basisPoints: input.basisPoints,
      providerRateBasisPoints: input.providerRateBasisPoints,
      providerFlatMinor: input.providerFlatMinor,
    },
    create: {
      code: input.code,
      version: 1,
      name: input.name,
      calculationType: 'TIERED',
      basisPoints: input.basisPoints,
      providerRateBasisPoints: input.providerRateBasisPoints,
      providerFlatMinor: input.providerFlatMinor,
      currency: 'NGN',
      payerType: 'USER',
      chargeEvent: input.chargeEvent,
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
    },
  });

  // Replaced wholesale rather than upserted one by one: a partial update could
  // leave a gap or an overlap between bands, which the assessor would reject.
  await prisma.feeTier.deleteMany({ where: { feeDefinitionId: definition.id } });
  await prisma.feeTier.createMany({
    data: input.tiers.map((tier) => ({ feeDefinitionId: definition.id, ...tier })),
  });
}
