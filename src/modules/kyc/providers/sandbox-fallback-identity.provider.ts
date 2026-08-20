import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  BankAccountInquiryOutcome,
  IdentityProvider,
  IdentityVerificationOutcome,
  ProviderBank,
} from './identity-provider.js';

/** Marks every result this class produced by falling back. Never removed. */
export const SANDBOX_FALLBACK_FLAG = 'SANDBOX_FALLBACK';

/**
 * Wraps the real provider so that sandbox limitations do not block testing
 * (ADR-006).
 *
 * Monnify test credentials cannot reach live BVN/NIN data. Without this, mobile
 * testing stalls on infrastructure rather than on anything about the app. With
 * it, a provider-side failure falls through to the mock so the flow completes.
 *
 * This is deliberately a weakening of a verification path, so it is fenced:
 *
 * - It is unreachable in production. `KYC_SANDBOX_FALLBACK` fails environment
 *   validation when `NODE_ENV=production`, so the process will not start.
 * - Only **provider-side failure** falls back — an unavailable service, or a
 *   check the sandbox does not support. A definitive "this identity does not
 *   exist" is a real answer and is returned unchanged; overriding it would make
 *   the fallback a way to verify arbitrary identities.
 * - Every fallback result carries `SANDBOX_FALLBACK` in its risk flags and
 *   reports `mock` as the provider. A sandbox pass is therefore permanently
 *   distinguishable in `kyc_checks` from a genuine one, so accounts promoted
 *   this way can be found and demoted before release.
 */
@Injectable()
export class SandboxFallbackIdentityProvider implements IdentityProvider {
  readonly name = 'monnify-sandbox';

  private readonly logger = new Logger(SandboxFallbackIdentityProvider.name);

  constructor(
    private readonly primary: IdentityProvider,
    private readonly fallback: IdentityProvider,
  ) {}

  async verifyIdentity(input: {
    kind: 'BVN' | 'NIN' | 'VNIN';
    identityNumber: string;
    legalName: string;
    dateOfBirth?: string;
  }): Promise<IdentityVerificationOutcome> {
    try {
      const outcome = await this.primary.verifyIdentity(input);
      // The sandbox reports vNIN as unsupported; that is a capability gap
      // rather than a verdict on the identity, so it may fall back.
      if (outcome.passed || outcome.resultCode !== 'UNSUPPORTED_IDENTITY_TYPE') return outcome;
      this.logger.warn(`Sandbox does not support ${input.kind}; falling back to the mock provider`);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      // Never log the error itself: it can carry the request URL or body, which
      // hold the identity number.
      this.logger.warn(`Identity provider unavailable for ${input.kind}; using sandbox fallback`);
    }

    return this.mark(await this.fallback.verifyIdentity(input));
  }

  async listBanks(): Promise<readonly ProviderBank[]> {
    try {
      const banks = await this.primary.listBanks();
      if (banks.length > 0) return banks;
      this.logger.warn('Provider returned an empty bank list; using sandbox fallback');
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      this.logger.warn('Bank list unavailable; using sandbox fallback');
    }
    return this.fallback.listBanks();
  }

  async inquireAccount(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<BankAccountInquiryOutcome> {
    try {
      return await this.primary.inquireAccount(input);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      this.logger.warn('Account inquiry unavailable; using sandbox fallback');
    }
    return this.mark(await this.fallback.inquireAccount(input));
  }

  /**
   * Stamps a fallback result so it can never be mistaken for a real check.
   * The provider is rewritten to the fallback's own name, because recording
   * `monnify` against a result Monnify never produced would corrupt the audit
   * trail exactly where it matters most.
   */
  private mark<T extends IdentityVerificationOutcome>(outcome: T): T {
    return {
      ...outcome,
      provider: this.fallback.name,
      riskFlags: [...outcome.riskFlags, SANDBOX_FALLBACK_FLAG],
    };
  }
}
