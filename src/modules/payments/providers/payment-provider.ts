/** Instructions shown to a user paying by bank transfer. */
export interface TransferInstructions {
  readonly bankName: string;
  readonly accountNumber: string;
  readonly accountName: string;
  /** What the payer must quote so the credit can be matched back. */
  readonly reference: string;
  readonly expiresAt: string;
}

export interface CreateChargeInput {
  readonly internalReference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Used by the provider for the receipt; never a raw identity number. */
  readonly customerEmail: string;
  readonly description: string;
}

export interface ProviderCharge {
  readonly providerReference: string;
  /** Present for a transfer payment. */
  readonly transferInstructions?: TransferInstructions;
  /** Present for a card payment: the hosted page the user is sent to. */
  readonly checkoutUrl?: string;
}

/**
 * The external rails a payment can use.
 *
 * Deliberately narrow: it creates a charge and reports what the provider says
 * about one. It never settles anything. Settlement is driven by verified
 * webhooks (ADR-006), so a compromised or confused provider response cannot
 * credit a wallet on its own.
 */
export interface PaymentProvider {
  readonly name: string;
  createTransferCharge(input: CreateChargeInput): Promise<ProviderCharge>;
  createCardCharge(input: CreateChargeInput): Promise<ProviderCharge>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
