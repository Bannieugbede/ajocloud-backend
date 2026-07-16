import { Injectable } from '@nestjs/common';
import type {
  BillPaymentProvider,
  Biller,
  BillCategory,
  BillCustomerValidation,
  CreateBillPaymentInput,
  ProviderBillPayment,
  ValidateBillCustomerInput,
} from './bill-payment-provider.js';

@Injectable()
export class MockBillPaymentProvider implements BillPaymentProvider {
  readonly name = 'mock';

  listCategories(): Promise<readonly BillCategory[]> {
    return Promise.resolve([{ code: 'electricity', name: 'Electricity' }]);
  }

  listBillers(categoryCode: string): Promise<readonly Biller[]> {
    if (categoryCode !== 'electricity') return Promise.resolve([]);
    return Promise.resolve([
      {
        code: 'mock-electric',
        categoryCode,
        name: 'Mock Electricity',
        products: [{ code: 'prepaid', name: 'Prepaid', currency: 'NGN', minimumMinor: 100_00n }],
      },
    ]);
  }

  validateCustomer(input: ValidateBillCustomerInput): Promise<BillCustomerValidation> {
    if (input.customerReference === 'invalid')
      return Promise.resolve({ valid: false, resultCode: 'INVALID' });
    return Promise.resolve({
      valid: true,
      providerReference: `mock-validation-${input.customerReference}`,
      customerName: 'Test Customer',
      resultCode: 'VALID',
    });
  }

  createPayment(input: CreateBillPaymentInput): Promise<ProviderBillPayment> {
    return Promise.resolve({
      providerReference: `mock-payment-${input.internalReference}`,
      state: 'SUCCESSFUL',
      providerStatus: 'SUCCESSFUL',
    });
  }

  queryPayment(reference: string): Promise<ProviderBillPayment> {
    return Promise.resolve({
      providerReference: reference,
      state: 'SUCCESSFUL',
      providerStatus: 'SUCCESSFUL',
    });
  }
}
