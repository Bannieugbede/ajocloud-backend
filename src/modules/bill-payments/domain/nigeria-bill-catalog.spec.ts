import { billReferenceProblem } from './bill-reference.js';
import { findCatalogBiller, NIGERIA_BILL_CATALOG } from './nigeria-bill-catalog.js';

describe('Nigerian bill catalogue', () => {
  const billers = NIGERIA_BILL_CATALOG.flatMap((category) => category.billers);

  it('offers Airtime, Internet, Electricity and Cable TV, in that order, and nothing else', () => {
    expect(NIGERIA_BILL_CATALOG.map((category) => category.name)).toEqual([
      'Airtime',
      'Internet',
      'Electricity',
      'Cable TV',
    ]);
  });

  it('lists every mobile network for airtime and data', () => {
    const names = (code: string) =>
      NIGERIA_BILL_CATALOG.find((category) => category.code === code)?.billers.map(
        (biller) => biller.name,
      );
    expect(names('AIRTIME')).toEqual(['MTN', 'Airtel', 'Glo', '9mobile']);
    expect(names('INTERNET')).toEqual(
      expect.arrayContaining(['MTN Data', 'Airtel Data', 'Glo Data', '9mobile Data', 'Smile']),
    );
  });

  it('lists every electricity distribution company', () => {
    const electricity = NIGERIA_BILL_CATALOG.find((category) => category.code === 'ELECTRICITY');
    expect(electricity?.billers.map((biller) => biller.code)).toEqual([
      'AEDC',
      'BEDC',
      'EKEDC',
      'EEDC',
      'IBEDC',
      'IKEDC',
      'JED',
      'KAEDCO',
      'KEDCO',
      'PHED',
      'YEDC',
      'APLE',
    ]);
  });

  it('uses each biller code once, so a code always names one biller', () => {
    const codes = billers.map((biller) => biller.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses each package code once within its biller', () => {
    for (const biller of billers) {
      const codes = biller.products.map((product) => product.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('keeps the codes stored payments already point at', () => {
    for (const [billerCode, productCode] of [
      ['EKEDC', 'EKEDC-PREPAID'],
      ['EKEDC', 'EKEDC-POSTPAID'],
      ['IKEDC', 'IKEDC-PREPAID'],
      ['DSTV', 'DSTV-COMPACT'],
      ['DSTV', 'DSTV-COMPACT-PLUS'],
      ['GOTV', 'GOTV-MAX'],
      ['SPECTRANET', 'SPECTRANET-UNLIMITED'],
    ]) {
      const found = findCatalogBiller(billerCode as string);
      expect(found?.biller.products.map((product) => product.code)).toContain(productCode);
    }
  });

  it('prices every package either exactly or within a positive range', () => {
    for (const product of billers.flatMap((biller) => biller.products)) {
      if (product.fixedAmountMinor !== undefined) {
        expect(product.fixedAmountMinor).toBeGreaterThan(0n);
      } else {
        expect(product.minimumMinor).toBeGreaterThan(0n);
        expect(product.maximumMinor).toBeGreaterThan(product.minimumMinor as bigint);
      }
    }
  });

  it('gives every biller a reference kind the validator understands', () => {
    for (const biller of billers) {
      expect(billReferenceProblem(biller.referenceKind, '')).not.toBeNull();
    }
  });
});
