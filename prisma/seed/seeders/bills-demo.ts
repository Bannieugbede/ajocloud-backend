import { createHmac } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { BillPaymentStatus, ReconciliationState } from '../../../generated/prisma/enums.js';
import { syncBillCatalog } from '../../../src/modules/bill-payments/bill-catalog-sync.js';
import { MockBillPaymentProvider } from '../../../src/modules/bill-payments/providers/mock-bill-payment.provider.js';
import { demoUser, type DemoUsers } from './demo-members.js';

/**
 * The bill catalogue and a history of paid bills.
 *
 * The catalogue is written by the same sync the service refreshes with, from
 * the development provider, so the seeded billers are exactly the ones the API
 * would list and there is one Nigerian catalogue to maintain, not two.
 *
 * The history matters as much as the catalogue: Home's Quick Pay is derived
 * from past payments, so without these the section renders empty however many
 * billers exist. Only settled payments are offered again, so the statuses here
 * decide what that section shows.
 */

const DAY = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

/**
 * Customer references are stored as a digest plus a mask, never in the clear
 * (the same rule identity numbers follow). The seed produces both from a
 * fabricated reference, so the rows are shaped exactly like real ones.
 */
function digestOf(reference: string): string {
  return createHmac('sha256', 'seed-only-pepper').update(reference).digest('hex');
}

function maskOf(reference: string): string {
  return reference.length <= 4
    ? '*'.repeat(reference.length)
    : `${'*'.repeat(reference.length - 4)}${reference.slice(-4)}`;
}

type PaymentPlan = {
  readonly id: string;
  readonly userKey: string;
  readonly categoryCode: string;
  readonly billerCode: string;
  readonly productCode: string;
  readonly reference: string;
  readonly customerName: string;
  readonly amountMinor: bigint;
  readonly status: BillPaymentStatus;
  readonly daysAgo: number;
};

const PAYMENTS: readonly PaymentPlan[] = [
  // The two Quick Pay cards on Home, newest first.
  {
    id: '40000000-0000-4000-8000-000000000601',
    userKey: 'chisom',
    categoryCode: 'CABLE_TV',
    billerCode: 'DSTV',
    productCode: 'DSTV-COMPACT-PLUS',
    reference: '7020147841',
    customerName: 'C OKAFOR',
    amountMinor: 24_500_00n,
    status: BillPaymentStatus.SUCCESSFUL,
    daysAgo: 6,
  },
  {
    id: '40000000-0000-4000-8000-000000000602',
    userKey: 'chisom',
    categoryCode: 'ELECTRICITY',
    billerCode: 'EKEDC',
    productCode: 'EKEDC-PREPAID',
    reference: '450123412293',
    customerName: 'C OKAFOR',
    amountMinor: 15_000_00n,
    status: BillPaymentStatus.SUCCESSFUL,
    daysAgo: 12,
  },
  // An older payment of the same DSTV reference: Quick Pay must collapse this
  // onto one card rather than listing the same decoder twice.
  {
    id: '40000000-0000-4000-8000-000000000603',
    userKey: 'chisom',
    categoryCode: 'CABLE_TV',
    billerCode: 'DSTV',
    productCode: 'DSTV-COMPACT-PLUS',
    reference: '7020147841',
    customerName: 'C OKAFOR',
    amountMinor: 24_500_00n,
    status: BillPaymentStatus.SUCCESSFUL,
    daysAgo: 37,
  },
  // A failure, which must never be offered again: re-offering it would imply
  // it had worked.
  {
    id: '40000000-0000-4000-8000-000000000604',
    userKey: 'chisom',
    categoryCode: 'INTERNET',
    billerCode: 'SPECTRANET',
    productCode: 'SPECTRANET-UNLIMITED',
    reference: 'SPN77CHANNEL01',
    customerName: 'C OKAFOR',
    amountMinor: 18_000_00n,
    status: BillPaymentStatus.FAILED,
    daysAgo: 20,
  },
  {
    id: '40000000-0000-4000-8000-000000000605',
    userKey: 'amaka',
    categoryCode: 'ELECTRICITY',
    billerCode: 'IKEDC',
    productCode: 'IKEDC-PREPAID',
    reference: '450198779987',
    customerName: 'A OBIORA',
    amountMinor: 10_000_00n,
    status: BillPaymentStatus.SUCCESSFUL,
    daysAgo: 4,
  },
];

export async function seedBillsDemo(prisma: PrismaClient, users: DemoUsers): Promise<void> {
  const refreshedAt = daysFromNow(-1);
  // The catalogue is cached from a provider and re-fetched when it expires, so
  // a far-future expiry keeps the demo from refetching against a mock.
  const expiresAt = daysFromNow(90);

  await syncBillCatalog(prisma, new MockBillPaymentProvider(), expiresAt, refreshedAt);

  for (const payment of PAYMENTS) {
    const userId = demoUser(users, payment.userKey);
    const wallet = await prisma.wallet.findUnique({
      where: { userId_currency: { userId, currency: 'NGN' } },
      select: { id: true },
    });
    if (!wallet) continue;
    const product = await prisma.billProduct.findFirst({
      where: {
        providerCode: payment.productCode,
        biller: {
          providerCode: payment.billerCode,
          category: { provider: 'mock', providerCode: payment.categoryCode },
        },
      },
      select: { id: true, billerId: true },
    });
    if (!product)
      throw new Error(`Seed bill product ${payment.productCode} is not in the catalogue`);

    const settled = payment.status === BillPaymentStatus.SUCCESSFUL;
    const createdAt = daysFromNow(-payment.daysAgo);

    await prisma.billPayment.upsert({
      where: { id: payment.id },
      update: {},
      create: {
        id: payment.id,
        internalReference: `SEEDBILL-${payment.id.slice(-6)}`,
        provider: 'mock',
        providerReference: settled ? `MOCK-${payment.id.slice(-8)}` : null,
        idempotencyKey: `seed:bill:${payment.id}`,
        requestHash: digestOf(payment.id),
        userId,
        walletId: wallet.id,
        billerId: product.billerId,
        productId: product.id,
        customerReferenceDigest: digestOf(payment.reference),
        customerReferenceMasked: maskOf(payment.reference),
        verifiedCustomerName: payment.customerName,
        amountMinor: payment.amountMinor,
        feeMinor: 0n,
        totalDebitMinor: payment.amountMinor,
        currency: 'NGN',
        status: payment.status,
        reconciliationState: ReconciliationState.NOT_REQUIRED,
        ...(settled ? {} : { failureReason: 'Provider declined the request' }),
        createdAt,
        ...(settled
          ? { completedAt: new Date(createdAt.getTime() + 45_000) }
          : { failedAt: createdAt }),
      },
    });
  }
}
