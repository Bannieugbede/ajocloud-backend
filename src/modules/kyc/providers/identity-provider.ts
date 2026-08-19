/**
 * The identity verification provider contract (ADR-004).
 *
 * Implementations receive a raw identity number as an argument and must not
 * persist, log, cache, or echo it. The value lives for the duration of the call.
 */

export interface IdentityVerificationOutcome {
  readonly provider: string;
  readonly providerReference: string;
  readonly passed: boolean;
  readonly resultCode: string;
  /** Legal name as held by the identity authority, used for advisory matching. */
  readonly verifiedName?: string;
  readonly riskFlags: readonly string[];
}

export interface BankAccountInquiryOutcome extends IdentityVerificationOutcome {
  /** Name on the account as returned by the bank, never user-supplied. */
  readonly accountName?: string;
}

export interface ProviderBank {
  readonly code: string;
  readonly name: string;
}

export interface IdentityProvider {
  readonly name: string;

  /**
   * @param identityNumber Raw BVN, NIN, or vNIN. Never stored by the caller or
   * the implementation.
   */
  verifyIdentity(input: {
    readonly kind: 'BVN' | 'NIN' | 'VNIN';
    readonly identityNumber: string;
    readonly legalName: string;
    readonly dateOfBirth?: string;
  }): Promise<IdentityVerificationOutcome>;

  listBanks(): Promise<readonly ProviderBank[]>;

  inquireAccount(input: {
    readonly bankCode: string;
    readonly accountNumber: string;
  }): Promise<BankAccountInquiryOutcome>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
