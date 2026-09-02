import {
  AccountType,
  FinancialAccountPurpose,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  type PrismaClient,
} from '../../../generated/prisma/client.js';

/**
 * Gives every seeded user a spendable wallet balance.
 *
 * There is no funding route: money enters a wallet through a payment rail that
 * is not wired up, so without this every development account has a zero balance
 * and none of the flows that spend money - sending, withdrawing, paying a bill
 * or a pool due - can be exercised at all.
 *
 * Posted as a real double-entry transaction against provider-payable rather
 * than written straight to a balance, so the seeded state is one the ledger
 * could actually have reached and reconciliation still adds up.
 */
const OPENING_BALANCE_NAIRA = 250_000;

export async function seedWalletFunding(prisma: PrismaClient): Promise<void> {
  const providerPayable = await prisma.financialAccount.findUnique({
    where: { code: 'PLATFORM:PROVIDER_PAYABLE:NGN' },
  });
  if (!providerPayable) return;

  const wallets = await prisma.wallet.findMany({
    where: { currency: 'NGN' },
    select: { id: true, userId: true },
  });

  for (const wallet of wallets) {
    const available = await prisma.financialAccount.upsert({
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

    // Reserved is created alongside it: a withdrawal moves funds here, and its
    // absence would fail the request rather than the balance check.
    await prisma.financialAccount.upsert({
      where: { code: `WALLET:${wallet.id}:RESERVED` },
      update: {},
      create: {
        code: `WALLET:${wallet.id}:RESERVED`,
        name: 'Wallet reserved balance',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.WALLET_RESERVED,
        walletId: wallet.id,
        currency: 'NGN',
      },
    });

    // Keyed per wallet so re-running the seed tops nobody up twice.
    const idempotencyKey = `dev:wallet-opening-balance:${wallet.id}`;
    const existing = await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) continue;

    await prisma.ledgerTransaction.create({
      data: {
        reference: `OPEN-${wallet.id.slice(0, 8).toUpperCase()}`,
        idempotencyKey,
        description: 'Development opening balance',
        currency: 'NGN',
        status: LedgerTransactionStatus.POSTED,
        initiatedByUserId: wallet.userId,
        postedAt: new Date(),
        entries: {
          create: [
            {
              accountId: providerPayable.id,
              direction: LedgerEntryDirection.DEBIT,
              amountMinor: BigInt(OPENING_BALANCE_NAIRA) * 100n,
              currency: 'NGN',
              sequence: 1,
            },
            {
              accountId: available.id,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: BigInt(OPENING_BALANCE_NAIRA) * 100n,
              currency: 'NGN',
              sequence: 2,
            },
          ],
        },
      },
    });
  }
}
