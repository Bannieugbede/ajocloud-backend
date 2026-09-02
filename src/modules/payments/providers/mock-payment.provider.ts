import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CreateChargeInput, PaymentProvider, ProviderCharge } from './payment-provider.js';

/**
 * Stands in for Monnify until credentials are configured.
 *
 * Values are derived from the internal reference rather than random, so a retry
 * of the same payment produces the same account number and reference. A random
 * one would make an idempotent retry look like a different payment.
 *
 * The account number is in the 9999xxxxxx range, which is not issuable by a real
 * Nigerian bank, so a mock instruction can never be mistaken for a live one.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  createTransferCharge(input: CreateChargeInput): Promise<ProviderCharge> {
    const digest = createHash('sha256').update(input.internalReference).digest('hex');
    const suffix = BigInt(`0x${digest.slice(0, 12)}`) % 1_000_000n;
    return Promise.resolve({
      providerReference: `mock-${input.internalReference}`,
      transferInstructions: {
        bankName: 'Mock Test Bank',
        accountNumber: `9999${suffix.toString().padStart(6, '0')}`,
        accountName: 'AJO CLOUD (TEST)',
        reference: input.internalReference,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    });
  }

  createCardCharge(input: CreateChargeInput): Promise<ProviderCharge> {
    return Promise.resolve({
      providerReference: `mock-${input.internalReference}`,
      checkoutUrl: `https://checkout.mock.invalid/${encodeURIComponent(input.internalReference)}`,
    });
  }
}
