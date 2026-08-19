import { Injectable } from '@nestjs/common';
import type {
  BankAccountInquiryOutcome,
  IdentityProvider,
  IdentityVerificationOutcome,
  ProviderBank,
} from './identity-provider.js';

/**
 * Development and CI provider. It never claims a real-world identity is
 * verified: it passes only for deterministic test identifiers, so no test or
 * demo can be mistaken for an actual verification.
 *
 * Passing identifiers end in `0001`. Everything else fails.
 */
@Injectable()
export class MockIdentityProvider implements IdentityProvider {
  readonly name = 'mock';

  verifyIdentity(input: {
    kind: 'BVN' | 'NIN' | 'VNIN';
    identityNumber: string;
    legalName: string;
  }): Promise<IdentityVerificationOutcome> {
    const passed = input.identityNumber.endsWith('0001');
    return Promise.resolve({
      provider: this.name,
      // Derived from the check kind, never from the identifier itself.
      providerReference: `mock-${input.kind.toLowerCase()}-${Date.now()}`,
      passed,
      resultCode: passed ? 'VERIFIED' : 'NOT_FOUND',
      // Echo the supplied name so name matching succeeds in development.
      ...(passed ? { verifiedName: input.legalName } : {}),
      riskFlags: [],
    });
  }

  listBanks(): Promise<readonly ProviderBank[]> {
    return Promise.resolve([
      { code: '000001', name: 'Mock Commercial Bank' },
      { code: '000002', name: 'Mock Microfinance Bank' },
    ]);
  }

  inquireAccount(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<BankAccountInquiryOutcome> {
    const passed = input.accountNumber.endsWith('0001');
    return Promise.resolve({
      provider: this.name,
      providerReference: `mock-account-${Date.now()}`,
      passed,
      resultCode: passed ? 'RESOLVED' : 'NOT_RESOLVED',
      ...(passed ? { accountName: 'Test Account Holder' } : {}),
      riskFlags: [],
    });
  }
}
