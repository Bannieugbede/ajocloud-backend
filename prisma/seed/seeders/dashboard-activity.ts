import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  AccountType,
  FeeAssessmentStatus,
  FinancialAccountPurpose,
  LedgerEntryDirection,
  LedgerTransactionStatus,
} from '../../../generated/prisma/enums.js';

/**
 * Rolling activity for the admin dashboard.
 *
 * The other seeders pin their records to fixed calendar dates, which drift out
 * of the dashboard's trailing windows (30-day KPIs, 10-week volume chart) as
 * time passes. These rows are dated relative to the run date so the console
 * always has something to show. Amounts are deterministic per week index, so
 * re-running produces a stable picture rather than random noise.
 */

const WEEKS = 10;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Contribution volume per trailing week, in naira. Index 0 is the oldest. */
const WEEKLY_VOLUME_NAIRA = [
  420_000, 610_000, 380_000, 720_000, 540_000, 890_000, 660_000, 980_000, 770_000, 1_150_000,
] as const;

const CONTRIBUTORS = [
  '40000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000005',
  '40000000-0000-4000-8000-000000000009',
] as const;

const DESCRIPTIONS = [
  'Ajo contribution — Sunshine Ajo Group',
  'Akawo deposit — School Fees',
  'Ajo contribution — Market Women Savings',
  'Wallet funding — bank transfer',
] as const;

export async function seedDashboardActivity(prisma: PrismaClient): Promise<void> {
  const now = Date.now();

  const providerPayable = await prisma.financialAccount.findUniqueOrThrow({
    where: { code: 'PLATFORM:PROVIDER_PAYABLE:NGN' },
  });
  const feeRevenue = await prisma.financialAccount.findUniqueOrThrow({
    where: { code: 'PLATFORM:FEE_REVENUE:NGN' },
  });

  // Resolve each contributor's wallet available account once up front.
  const walletAccounts = new Map<string, string>();
  for (const userId of CONTRIBUTORS) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId_currency: { userId, currency: 'NGN' } },
    });
    if (!wallet) continue;
    const account = await prisma.financialAccount.upsert({
      where: { code: `WALLET:${wallet.id}:AVAILABLE` },
      update: {},
      create: {
        code: `WALLET:${wallet.id}:AVAILABLE`,
        name: 'Wallet available balance',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
        walletId: wallet.id,
        currency: 'NGN',
      },
    });
    walletAccounts.set(userId, account.id);
  }
  if (walletAccounts.size === 0) return;

  const contributors = CONTRIBUTORS.filter((userId) => walletAccounts.has(userId));
  const feeDefinition = await prisma.feeDefinition.findFirst({
    where: { code: 'PLATFORM_CONTRIBUTION_FIXED' },
    orderBy: { version: 'desc' },
  });

  for (let week = 0; week < WEEKS; week += 1) {
    // Post mid-week so the row sits clearly inside its bucket.
    const postedAt = new Date(now - (WEEKS - week) * 7 * DAY_MS + 3 * DAY_MS);
    const userId = contributors[week % contributors.length]!;
    const accountId = walletAccounts.get(userId)!;
    const amountMinor = BigInt(WEEKLY_VOLUME_NAIRA[week]!) * 100n;
    const idempotencyKey = `dev:dashboard-volume:${week}`;

    const existing = await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey } });
    const transaction = existing
      ? await prisma.ledgerTransaction.update({
          where: { idempotencyKey },
          data: { postedAt },
        })
      : await prisma.ledgerTransaction.create({
          data: {
            reference: `TXN-DEV-${String(90_000 + week)}`,
            idempotencyKey,
            description: DESCRIPTIONS[week % DESCRIPTIONS.length]!,
            currency: 'NGN',
            status: LedgerTransactionStatus.POSTED,
            initiatedByUserId: userId,
            postedAt,
            entries: {
              create: [
                {
                  accountId: providerPayable.id,
                  direction: LedgerEntryDirection.DEBIT,
                  amountMinor,
                  currency: 'NGN',
                  sequence: 1,
                },
                {
                  accountId,
                  direction: LedgerEntryDirection.CREDIT,
                  amountMinor,
                  currency: 'NGN',
                  sequence: 2,
                },
              ],
            },
          },
        });

    if (!feeDefinition) continue;

    // A 2% platform fee on each contribution, so the fees KPI is populated.
    const feeMinor = amountMinor / 50n;
    const feeId = deterministicUuid('a1', week);
    const feeExists = await prisma.feeAssessment.findUnique({ where: { id: feeId } });
    if (feeExists) {
      await prisma.feeAssessment.update({ where: { id: feeId }, data: { createdAt: postedAt } });
      continue;
    }
    await prisma.feeAssessment.create({
      data: {
        id: feeId,
        feeDefinitionId: feeDefinition.id,
        subjectType: 'LedgerTransaction',
        subjectId: transaction.id,
        amountMinor: feeMinor,
        currency: 'NGN',
        status: FeeAssessmentStatus.PAID,
        ledgerTransactionId: transaction.id,
        calculationBaseMinor: amountMinor,
        ruleSnapshot: { basisPoints: 200, source: 'seed:dashboard-activity' },
        createdAt: postedAt,
      },
    });

    await prisma.ledgerTransaction.upsert({
      where: { idempotencyKey: `dev:dashboard-fee:${week}` },
      update: { postedAt },
      create: {
        reference: `FEE-DEV-${String(90_000 + week)}`,
        idempotencyKey: `dev:dashboard-fee:${week}`,
        description: 'Platform fee — contribution',
        currency: 'NGN',
        status: LedgerTransactionStatus.POSTED,
        initiatedByUserId: userId,
        postedAt,
        entries: {
          create: [
            {
              accountId,
              direction: LedgerEntryDirection.DEBIT,
              amountMinor: feeMinor,
              currency: 'NGN',
              sequence: 1,
            },
            {
              accountId: feeRevenue.id,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: feeMinor,
              currency: 'NGN',
              sequence: 2,
            },
          ],
        },
      },
    });
  }
}

/** Stable UUIDs so repeat runs update rather than duplicate. */
function deterministicUuid(prefix: string, index: number): string {
  return `${prefix}000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}
