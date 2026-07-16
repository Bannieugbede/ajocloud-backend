export interface BillCategory {
  readonly code: string;
  readonly name: string;
}

export interface Biller {
  readonly code: string;
  readonly categoryCode: string;
  readonly name: string;
  readonly products: readonly BillerProduct[];
}

export interface BillerProduct {
  readonly code: string;
  readonly name: string;
  readonly currency: string;
  readonly minimumMinor?: bigint;
  readonly maximumMinor?: bigint;
  readonly fixedAmountMinor?: bigint;
}

export interface ValidateBillCustomerInput {
  readonly billerCode: string;
  readonly productCode?: string;
  readonly customerReference: string;
}

export interface BillCustomerValidation {
  readonly valid: boolean;
  readonly providerReference?: string;
  readonly customerName?: string;
  readonly resultCode: string;
}

export interface CreateBillPaymentInput {
  readonly internalReference: string;
  readonly billerCode: string;
  readonly productCode?: string;
  readonly customerReference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export type ProviderBillPaymentState = 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'UNKNOWN' | 'REVERSED';

export interface ProviderBillPayment {
  readonly providerReference?: string;
  readonly state: ProviderBillPaymentState;
  readonly providerStatus: string;
  readonly failureCode?: string;
}

export interface BillPaymentProvider {
  readonly name: string;
  listCategories(): Promise<readonly BillCategory[]>;
  listBillers(categoryCode: string): Promise<readonly Biller[]>;
  validateCustomer(input: ValidateBillCustomerInput): Promise<BillCustomerValidation>;
  createPayment(input: CreateBillPaymentInput): Promise<ProviderBillPayment>;
  queryPayment(reference: string): Promise<ProviderBillPayment>;
}

export const BILL_PAYMENT_PROVIDER = Symbol('BILL_PAYMENT_PROVIDER');
