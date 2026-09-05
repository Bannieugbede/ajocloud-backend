import { createHmac } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  BillCatalogStatus,
  BillPaymentStatus,
  ReconciliationState,
} from '../../../generated/prisma/enums.js';
import { demoUser, type DemoUsers } from './demo-members.js';

/**
 * The bill catalogue and a history of paid bills.
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

type BillerPlan = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly products: readonly {
    id: string;
    code: string;
    name: string;
    minimumMinor?: bigint;
    fixedAmountMinor?: bigint;
  }[];
};

type CategoryPlan = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly billers: readonly BillerPlan[];
};

/** Names match the shortcuts on Home, so a tapped shortcut finds its category. */
const CATEGORIES: readonly CategoryPlan[] = [
  {
    id: '40000000-0000-4000-8000-000000000501',
    code: 'ELECTRICITY',
    name: 'Electricity',
    billers: [
      {
        id: '40000000-0000-4000-8000-000000000511',
        code: 'EKEDC',
        name: 'EKEDC',
        products: [
          {
            id: '40000000-0000-4000-8000-000000000521',
            code: 'EKEDC-PREPAID',
            name: 'Prepaid meter',
            minimumMinor: 1_000_00n,
          },
          {
            id: '40000000-0000-4000-8000-000000000522',
            code: 'EKEDC-POSTPAID',
            name: 'Postpaid account',
            minimumMinor: 1_000_00n,
          },
        ],
      },
      {
        id: '40000000-0000-4000-8000-000000000512',
        code: 'IKEDC',
        name: 'IKEDC',
        products: [
          {
            id: '40000000-0000-4000-8000-000000000523',
            code: 'IKEDC-PREPAID',
            name: 'Prepaid meter',
            minimumMinor: 1_000_00n,
          },
        ],
      },
    ],
  },
  {
    id: '40000000-0000-4000-8000-000000000502',
    code: 'WATER',
    name: 'Water',
    billers: [
      {
        id: '40000000-0000-4000-8000-000000000513',
        code: 'LWC',
        name: 'Lagos Water Corporation',
        products: [
          {
            id: '40000000-0000-4000-8000-000000000524',
            code: 'LWC-STANDARD',
            name: 'Water bill',
            minimumMinor: 500_00n,
          },
        ],
      },
    ],
  },
  {
    id: '40000000-0000-4000-8000-000000000503',
    code: 'CABLE_TV',
    name: 'Cable TV',
    billers: [
      {
        id: '40000000-0000-4000-8000-000000000514',
        code: 'DSTV',
        name: 'DSTV',
        products: [
          {
            id: '40000000-0000-4000-8000-000000000525',
            code: 'DSTV-COMPACT',
            name: 'Compact',
            fixedAmountMinor: 19_000_00n,
          },
          {
            id: '40000000-0000-4000-8000-000000000526',
            code: 'DSTV-COMPACT-PLUS',
            name: 'Compact Plus',
            fixedAmountMinor: 24_500_00n,
          },
        ],
      },
      {
        id: '40000000-0000-4000-8000-000000000515',
        code: 'GOTV',
        name: 'GOtv',
        products: [
          {
            id: '40000000-0000-4000-8000-000000000527',
            code: 'GOTV-MAX',
            name: 'Max',
            fixedAmountMinor: 8_500_00n,
          },
        ],
      },
    ],
  },
  {
    id: '40000000-0000-4000-8000-000000000504',
    code: 'INTERNET',
    name: 'Internet',
    billers: [
      {
        id: '40000000-0000-4000-8000-000000000516',
        code: 'SPECTRANET',
        name: 'Spectranet',
        products: [
          {
            id: '40000000-0000-4000-8000-000000000528',
            code: 'SPECTRANET-UNLIMITED',
            name: 'Unlimited monthly',
            fixedAmountMinor: 18_000_00n,
          },
        ],
      },
    ],
  },
];

type PaymentPlan = {
  readonly id: string;
  readonly userKey: string;
  readonly billerId: string;
  readonly productId: string;
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
    billerId: '40000000-0000-4000-8000-000000000514',
    productId: '40000000-0000-4000-8000-000000000526',
    reference: '20147841',
    customerName: 'C OKAFOR',
    amountMinor: 24_500_00n,
    status: BillPaymentStatus.SUCCESSFUL,
    daysAgo: 6,
  },
  {
    id: '40000000-0000-4000-8000-000000000602',
    userKey: 'chisom',
    billerId: '40000000-0000-4000-8000-000000000511',
    productId: '40000000-0000-4000-8000-000000000521',
    reference: '45012293',
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
    billerId: '40000000-0000-4000-8000-000000000514',
    productId: '40000000-0000-4000-8000-000000000526',
    reference: '20147841',
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
    billerId: '40000000-0000-4000-8000-000000000516',
    productId: '40000000-0000-4000-8000-000000000528',
    reference: '77channel01',
    customerName: 'C OKAFOR',
    amountMinor: 18_000_00n,
    status: BillPaymentStatus.FAILED,
    daysAgo: 20,
  },
  {
    id: '40000000-0000-4000-8000-000000000605',
    userKey: 'amaka',
    billerId: '40000000-0000-4000-8000-000000000512',
    productId: '40000000-0000-4000-8000-000000000523',
    reference: '45019987',
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

  for (const category of CATEGORIES) {
    await prisma.billCategory.upsert({
      where: { provider_providerCode: { provider: 'mock', providerCode: category.code } },
      update: { name: category.name, refreshedAt, expiresAt },
      create: {
        id: category.id,
        provider: 'mock',
        providerCode: category.code,
        name: category.name,
        status: BillCatalogStatus.ACTIVE,
        refreshedAt,
        expiresAt,
      },
    });

    for (const biller of category.billers) {
      await prisma.billBiller.upsert({
        where: { categoryId_providerCode: { categoryId: category.id, providerCode: biller.code } },
        update: { name: biller.name, refreshedAt, expiresAt },
        create: {
          id: biller.id,
          categoryId: category.id,
          providerCode: biller.code,
          name: biller.name,
          status: BillCatalogStatus.ACTIVE,
          refreshedAt,
          expiresAt,
        },
      });

      for (const product of biller.products) {
        await prisma.billProduct.upsert({
          where: { billerId_providerCode: { billerId: biller.id, providerCode: product.code } },
          update: { name: product.name },
          create: {
            id: product.id,
            billerId: biller.id,
            providerCode: product.code,
            name: product.name,
            status: BillCatalogStatus.ACTIVE,
            currency: 'NGN',
            ...(product.minimumMinor === undefined ? {} : { minimumMinor: product.minimumMinor }),
            ...(product.fixedAmountMinor === undefined
              ? {}
              : { fixedAmountMinor: product.fixedAmountMinor }),
          },
        });
      }
    }
  }

  for (const payment of PAYMENTS) {
    const userId = demoUser(users, payment.userKey);
    const wallet = await prisma.wallet.findUnique({
      where: { userId_currency: { userId, currency: 'NGN' } },
      select: { id: true },
    });
    if (!wallet) continue;

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
        billerId: payment.billerId,
        productId: payment.productId,
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
