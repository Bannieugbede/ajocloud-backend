import { Injectable } from '@nestjs/common';
import { billReferenceProblem, normaliseBillReference } from '../domain/bill-reference.js';
import {
  findCatalogBiller,
  NIGERIA_BILL_CATALOG,
  NIGERIA_BILL_CATALOG_REVISION,
} from '../domain/nigeria-bill-catalog.js';
import type {
  BillPaymentProvider,
  Biller,
  BillCategory,
  BillCustomerValidation,
  CreateBillPaymentInput,
  ProviderBillPayment,
  ValidateBillCustomerInput,
} from './bill-payment-provider.js';

/**
 * The development provider: the full Nigerian catalogue, deterministic
 * validation, and settlement that always succeeds. Never a claim of real
 * payment; it exists so every screen can be exercised end to end.
 *
 * Deterministic rejections, for testing the unhappy paths:
 * - a reference of the wrong shape for its biller is invalid;
 * - the literal reference "invalid", and any reference ending in "0000", are
 *   refused as if the provider did not recognise them;
 * - a reference ending in "9999" validates but its payment is declined, so a
 *   failed bill and the refund that follows can be exercised.
 */
@Injectable()
export class MockBillPaymentProvider implements BillPaymentProvider {
  readonly name: string = 'mock';
  readonly catalogRevision = NIGERIA_BILL_CATALOG_REVISION;

  listCategories(): Promise<readonly BillCategory[]> {
    return Promise.resolve(
      NIGERIA_BILL_CATALOG.map((category) => ({ code: category.code, name: category.name })),
    );
  }

  listBillers(categoryCode: string): Promise<readonly Biller[]> {
    const category = NIGERIA_BILL_CATALOG.find((candidate) => candidate.code === categoryCode);
    if (!category) return Promise.resolve([]);
    return Promise.resolve(
      category.billers.map((biller) => ({
        code: biller.code,
        categoryCode,
        name: biller.name,
        referenceKind: biller.referenceKind,
        ...(biller.referenceLabel ? { referenceLabel: biller.referenceLabel } : {}),
        products: biller.products.map((product) => ({ ...product, currency: 'NGN' })),
      })),
    );
  }

  validateCustomer(input: ValidateBillCustomerInput): Promise<BillCustomerValidation> {
    const found = findCatalogBiller(input.billerCode);
    if (!found) return Promise.resolve({ valid: false, resultCode: 'UNKNOWN_BILLER' });
    const { biller } = found;
    const reference = normaliseBillReference(biller.referenceKind, input.customerReference);
    if (
      input.customerReference === 'invalid' ||
      reference.endsWith('0000') ||
      billReferenceProblem(biller.referenceKind, reference)
    ) {
      return Promise.resolve({ valid: false, resultCode: 'INVALID' });
    }
    return Promise.resolve({
      valid: true,
      providerReference: `mock-validation-${reference}`,
      // A phone line has no account holder to show; a meter, decoder or ISP
      // account does, and seeing it is how a payer catches a mistyped number.
      ...(biller.referenceKind === 'phone' ? {} : { customerName: 'Test Customer' }),
      resultCode: 'VALID',
    });
  }

  createPayment(input: CreateBillPaymentInput): Promise<ProviderBillPayment> {
    if (input.customerReference.endsWith('9999')) {
      return Promise.resolve({
        providerReference: `mock-payment-${input.internalReference}`,
        state: 'FAILED',
        providerStatus: 'DECLINED',
        failureCode: 'MOCK_DECLINED',
      });
    }
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
