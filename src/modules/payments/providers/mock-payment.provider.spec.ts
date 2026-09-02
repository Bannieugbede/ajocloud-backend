import { MockPaymentProvider } from './mock-payment.provider.js';

const input = {
  internalReference: 'PAY-ABC123',
  amountMinor: 5_000_00n,
  currency: 'NGN',
  customerEmail: 'member@example.test',
  description: 'Akawo pool: Class of 2026',
};

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  it('returns the same account number for a retried reference', async () => {
    const first = await provider.createTransferCharge(input);
    const second = await provider.createTransferCharge(input);
    // A random account number would make an idempotent retry look like a new
    // payment, and the payer would be shown a second set of instructions.
    expect(first.transferInstructions?.accountNumber).toBe(
      second.transferInstructions?.accountNumber,
    );
  });

  it('differs between references', async () => {
    const other = await provider.createTransferCharge({
      ...input,
      internalReference: 'PAY-XYZ789',
    });
    const first = await provider.createTransferCharge(input);
    expect(other.transferInstructions?.accountNumber).not.toBe(
      first.transferInstructions?.accountNumber,
    );
  });

  it('uses an account number no real Nigerian bank can issue', async () => {
    const charge = await provider.createTransferCharge(input);
    // So a mock instruction can never be mistaken for a live one.
    expect(charge.transferInstructions?.accountNumber).toMatch(/^9999\d{6}$/);
  });

  it('quotes the internal reference so a credit can be matched back', async () => {
    const charge = await provider.createTransferCharge(input);
    expect(charge.transferInstructions?.reference).toBe(input.internalReference);
  });

  it('returns a non-resolvable checkout host for a card charge', async () => {
    const charge = await provider.createCardCharge(input);
    // .invalid is reserved by RFC 2606 and can never resolve, so a mock URL
    // cannot accidentally send a user to a real page.
    expect(charge.checkoutUrl).toContain('.invalid/');
  });
});
