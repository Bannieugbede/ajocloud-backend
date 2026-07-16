import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  BillPaymentProvider,
  Biller,
  BillCategory,
  BillCustomerValidation,
  ProviderBillPayment,
} from '../../../modules/bill-payments/providers/bill-payment-provider.js';

/**
 * Deliberately blocked until current official Monnify bill-payment endpoints,
 * authentication, payloads, status mapping, signing, and webhook rules are supplied and reviewed.
 */
@Injectable()
export class MonnifyBillPaymentProvider implements BillPaymentProvider {
  readonly name = 'monnify';

  listCategories(): Promise<readonly BillCategory[]> {
    return this.blocked();
  }

  listBillers(): Promise<readonly Biller[]> {
    return this.blocked();
  }

  validateCustomer(): Promise<BillCustomerValidation> {
    return this.blocked();
  }

  createPayment(): Promise<ProviderBillPayment> {
    return this.blocked();
  }

  queryPayment(): Promise<ProviderBillPayment> {
    return this.blocked();
  }

  private blocked<T>(): Promise<T> {
    throw new NotImplementedException(
      'Monnify Bill Payment adapter is blocked pending verified official integration specifications',
    );
  }
}
