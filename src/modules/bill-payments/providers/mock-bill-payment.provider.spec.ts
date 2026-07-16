import { MockBillPaymentProvider } from './mock-bill-payment.provider.js';

describe('mock Bill Payment provider', () => {
  const provider = new MockBillPaymentProvider();

  it('validates a test customer without exposing a real provider', async () => {
    await expect(
      provider.validateCustomer({ billerCode: 'mock-electric', customerReference: '123456' }),
    ).resolves.toMatchObject({ valid: true, customerName: 'Test Customer' });
  });

  it('rejects the deterministic invalid test reference', async () => {
    await expect(
      provider.validateCustomer({ billerCode: 'mock-electric', customerReference: 'invalid' }),
    ).resolves.toMatchObject({ valid: false });
  });
});
