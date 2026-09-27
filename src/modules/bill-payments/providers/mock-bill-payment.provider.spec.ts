import { MockBillPaymentProvider } from './mock-bill-payment.provider.js';

describe('mock Bill Payment provider', () => {
  const provider = new MockBillPaymentProvider();

  it('serves the whole catalogue with packages', async () => {
    const categories = await provider.listCategories();
    expect(categories.map((category) => category.code)).toEqual([
      'AIRTIME',
      'INTERNET',
      'ELECTRICITY',
      'CABLE_TV',
    ]);
    const data = await provider.listBillers('INTERNET');
    const mtn = data.find((biller) => biller.code === 'MTN-DATA');
    expect(mtn?.referenceKind).toBe('phone');
    expect(mtn?.products.length).toBeGreaterThan(5);
    expect(mtn?.products[0]?.currency).toBe('NGN');
    expect(typeof mtn?.products[0]?.validity).toBe('string');
  });

  it('lists nothing for a category it does not have', async () => {
    await expect(provider.listBillers('WATER')).resolves.toEqual([]);
  });

  it('validates a meter and names its holder', async () => {
    await expect(
      provider.validateCustomer({ billerCode: 'EKEDC', customerReference: '45012345678' }),
    ).resolves.toMatchObject({ valid: true, customerName: 'Test Customer' });
  });

  it('validates a phone line without inventing an account holder', async () => {
    const result = await provider.validateCustomer({
      billerCode: 'MTN',
      customerReference: '08031234567',
    });
    expect(result.valid).toBe(true);
    expect(result.customerName).toBeUndefined();
  });

  it.each([
    ['MTN', '0803123'],
    ['EKEDC', '45012340000'],
    ['DSTV', 'invalid'],
    ['NOT-A-BILLER', '08031234567'],
  ])('refuses %s reference %s', async (billerCode, customerReference) => {
    await expect(
      provider.validateCustomer({ billerCode, customerReference }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('declines a payment for a reference ending in 9999, after validating it', async () => {
    await expect(
      provider.validateCustomer({ billerCode: 'MTN', customerReference: '08031239999' }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      provider.createPayment({
        internalReference: 'BILL-1',
        billerCode: 'MTN',
        customerReference: '08031239999',
        amountMinor: 100_00n,
        currency: 'NGN',
      }),
    ).resolves.toMatchObject({ state: 'FAILED' });
  });
});
