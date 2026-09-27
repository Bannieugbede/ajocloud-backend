import type { BillReferenceKind } from './bill-reference.js';

/**
 * The bills Ajo Cloud offers in Nigeria, defined once.
 *
 * Four categories, in the order they are shown: Airtime and Internet list every
 * network and ISP a member is likely to use, each with its own packages;
 * Electricity and Cable TV are the predefined DisCos and pay-TV operators.
 *
 * This is the catalogue the development provider serves and the seed writes, so
 * the two can never drift into listing different billers. Codes are stable
 * identifiers: stored payments point at the rows they name, so a code is never
 * reused for a different biller or package. Removing an entry retires its row
 * on the next catalogue refresh rather than deleting it.
 *
 * Package prices are indicative. Operators reprice often, and a live provider's
 * own catalogue replaces this one entirely; see docs/bill-payments.md.
 */

/** Bumped whenever the catalogue changes, so stored copies refresh at once. */
export const NIGERIA_BILL_CATALOG_REVISION = '2026-09-27.1';

export interface CatalogProduct {
  readonly code: string;
  readonly name: string;
  /** How long a package lasts, shown beside its price. */
  readonly validity?: string;
  readonly minimumMinor?: bigint;
  readonly maximumMinor?: bigint;
  readonly fixedAmountMinor?: bigint;
}

export interface CatalogBiller {
  readonly code: string;
  readonly name: string;
  readonly referenceKind: BillReferenceKind;
  /** The payer-facing name of the reference, when the kind's default is vague. */
  readonly referenceLabel?: string;
  readonly products: readonly CatalogProduct[];
}

export interface CatalogCategory {
  readonly code: string;
  readonly name: string;
  readonly billers: readonly CatalogBiller[];
}

const naira = (amount: number): bigint => BigInt(Math.round(amount * 100));

function topUp(code: string): CatalogProduct {
  return {
    code: `${code}-VTU`,
    name: 'Airtime top-up',
    minimumMinor: naira(50),
    maximumMinor: naira(50_000),
  };
}

type Plan = readonly [code: string, name: string, validity: string, price: number];

function plans(prefix: string, list: readonly Plan[]): CatalogProduct[] {
  return list.map(([code, name, validity, price]) => ({
    code: `${prefix}-${code}`,
    name,
    validity,
    fixedAmountMinor: naira(price),
  }));
}

function disco(code: string, name: string, postpaid = true): CatalogBiller {
  const limits = { minimumMinor: naira(1_000), maximumMinor: naira(500_000) };
  return {
    code,
    name,
    referenceKind: 'meter',
    products: [
      { code: `${code}-PREPAID`, name: 'Prepaid meter', ...limits },
      ...(postpaid ? [{ code: `${code}-POSTPAID`, name: 'Postpaid account', ...limits }] : []),
    ],
  };
}

const MOBILE_DATA: readonly Plan[] = [
  ['1GB-1D', '1GB', '1 day', 500],
  ['2_5GB-2D', '2.5GB', '2 days', 900],
  ['1_5GB-7D', '1.5GB', '7 days', 1_000],
  ['2GB-30D', '2GB', '30 days', 1_500],
  ['3_5GB-30D', '3.5GB', '30 days', 2_500],
  ['7GB-30D', '7GB', '30 days', 3_500],
  ['10GB-30D', '10GB', '30 days', 4_500],
  ['20GB-30D', '20GB', '30 days', 7_500],
  ['40GB-30D', '40GB', '30 days', 11_000],
  ['75GB-30D', '75GB', '30 days', 18_000],
];

const NETWORKS = [
  { code: 'MTN', name: 'MTN' },
  { code: 'AIRTEL', name: 'Airtel' },
  { code: 'GLO', name: 'Glo' },
  { code: '9MOBILE', name: '9mobile' },
] as const;

export const NIGERIA_BILL_CATALOG: readonly CatalogCategory[] = [
  {
    code: 'AIRTIME',
    name: 'Airtime',
    billers: NETWORKS.map((network) => ({
      code: network.code,
      name: network.name,
      referenceKind: 'phone',
      products: [topUp(network.code)],
    })),
  },
  {
    code: 'INTERNET',
    name: 'Internet',
    billers: [
      ...NETWORKS.map((network): CatalogBiller => ({
        code: `${network.code}-DATA`,
        name: `${network.name} Data`,
        referenceKind: 'phone',
        products: plans(`${network.code}-DATA`, MOBILE_DATA),
      })),
      {
        code: 'SMILE',
        name: 'Smile',
        referenceKind: 'account',
        referenceLabel: 'Smile account number',
        products: plans('SMILE', [
          ['1GB-1D', '1GB FlexiDaily', '1 day', 350],
          ['6GB-7D', '6GB FlexiWeekly', '7 days', 1_500],
          ['3GB-30D', '3GB', '30 days', 3_000],
          ['10GB-30D', '10GB', '30 days', 7_500],
          ['20GB-30D', '20GB', '30 days', 12_500],
          ['UNLIMITED-LITE', 'Unlimited Lite', '30 days', 18_000],
          ['UNLIMITED-ESSENTIAL', 'Unlimited Essential', '30 days', 27_500],
        ]),
      },
      {
        code: 'SPECTRANET',
        name: 'Spectranet',
        referenceKind: 'account',
        referenceLabel: 'Spectranet customer ID',
        products: plans('SPECTRANET', [
          ['VALUE-7D', 'Value 7GB', '7 days', 2_000],
          ['VALUE-25GB', 'Value 25GB', '30 days', 7_500],
          ['VALUE-60GB', 'Value 60GB', '30 days', 12_500],
          ['UNLIMITED', 'Unlimited monthly', '30 days', 18_000],
          ['UNLIMITED-PLUS', 'Unlimited Plus', '30 days', 30_000],
        ]),
      },
    ],
  },
  {
    code: 'ELECTRICITY',
    name: 'Electricity',
    billers: [
      disco('AEDC', 'Abuja Electric (AEDC)'),
      disco('BEDC', 'Benin Electric (BEDC)'),
      disco('EKEDC', 'Eko Electric (EKEDC)'),
      disco('EEDC', 'Enugu Electric (EEDC)'),
      disco('IBEDC', 'Ibadan Electric (IBEDC)'),
      disco('IKEDC', 'Ikeja Electric (IKEDC)'),
      disco('JED', 'Jos Electric (JED)'),
      disco('KAEDCO', 'Kaduna Electric (KAEDCO)'),
      disco('KEDCO', 'Kano Electric (KEDCO)'),
      disco('PHED', 'Port Harcourt Electric (PHED)'),
      disco('YEDC', 'Yola Electric (YEDC)'),
      disco('APLE', 'Aba Power (APLE)', false),
    ],
  },
  {
    code: 'CABLE_TV',
    name: 'Cable TV',
    billers: [
      {
        code: 'DSTV',
        name: 'DStv',
        referenceKind: 'smartcard',
        referenceLabel: 'Smartcard number',
        products: plans('DSTV', [
          ['PADI', 'Padi', '1 month', 4_400],
          ['YANGA', 'Yanga', '1 month', 6_000],
          ['CONFAM', 'Confam', '1 month', 11_000],
          ['COMPACT', 'Compact', '1 month', 19_000],
          ['COMPACT-PLUS', 'Compact Plus', '1 month', 30_000],
          ['PREMIUM', 'Premium', '1 month', 44_500],
        ]),
      },
      {
        code: 'GOTV',
        name: 'GOtv',
        referenceKind: 'smartcard',
        referenceLabel: 'IUC number',
        products: plans('GOTV', [
          ['SMALLIE', 'Smallie', '1 month', 1_900],
          ['JINJA', 'Jinja', '1 month', 3_900],
          ['JOLLI', 'Jolli', '1 month', 5_800],
          ['MAX', 'Max', '1 month', 8_500],
          ['SUPA', 'Supa', '1 month', 11_400],
          ['SUPA-PLUS', 'Supa+', '1 month', 16_800],
        ]),
      },
      {
        code: 'STARTIMES',
        name: 'StarTimes',
        referenceKind: 'smartcard',
        referenceLabel: 'Smartcard number',
        products: plans('STARTIMES', [
          ['NOVA', 'Nova', '1 month', 1_900],
          ['BASIC', 'Basic', '1 month', 3_700],
          ['SMART', 'Smart', '1 month', 4_700],
          ['CLASSIC', 'Classic', '1 month', 5_500],
          ['SUPER', 'Super', '1 month', 9_000],
        ]),
      },
    ],
  },
];

/** The biller a code names, with the category it sits in. */
export function findCatalogBiller(
  billerCode: string,
): { category: CatalogCategory; biller: CatalogBiller } | null {
  for (const category of NIGERIA_BILL_CATALOG) {
    const biller = category.billers.find((candidate) => candidate.code === billerCode);
    if (biller) return { category, biller };
  }
  return null;
}
