import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Environment } from '../../../config/env.schema.js';
import type {
  BankAccountInquiryOutcome,
  IdentityProvider,
  IdentityVerificationOutcome,
  ProviderBank,
} from '../../../modules/kyc/providers/identity-provider.js';
import { BANK_LIST_CACHE_TTL_MS } from '../../../modules/kyc/domain/identity-verification-policy.js';

const DEFAULT_BASE_URL = 'https://api.dojah.io';
const REQUEST_TIMEOUT_MS = 20_000;

/** Dojah returns the identity payload under `entity`. */
interface DojahEnvelope<T> {
  readonly entity?: T;
}

interface DojahIdentityEntity {
  readonly first_name?: string;
  readonly last_name?: string;
  readonly middle_name?: string;
  readonly date_of_birth?: string;
}

interface DojahAccountEntity {
  readonly account_name?: string;
  readonly account_number?: string;
}

interface DojahBankEntity {
  readonly code?: string;
  readonly name?: string;
  readonly nip_code?: string;
}

/**
 * Dojah identity verification (ADR-004).
 *
 * The identity number is sent to Dojah over TLS and is never stored, logged, or
 * included in any error this class raises. Errors deliberately carry only a
 * status code, because a transport error object can hold the request body.
 */
@Injectable()
export class DojahIdentityProvider implements IdentityProvider {
  readonly name = 'dojah';

  private readonly logger = new Logger(DojahIdentityProvider.name);
  private readonly appId: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly baseUrl: string;
  private bankCache: { banks: readonly ProviderBank[]; fetchedAt: number } | null = null;

  constructor(config: ConfigService<Environment, true>) {
    this.appId = config.get('DOJAH_APP_ID', { infer: true }) || undefined;
    this.secretKey = config.get('DOJAH_SECRET_KEY', { infer: true }) || undefined;
    this.baseUrl = (config.get('DOJAH_BASE_URL', { infer: true }) || DEFAULT_BASE_URL).replace(
      /\/$/,
      '',
    );
  }

  async verifyIdentity(input: {
    kind: 'BVN' | 'NIN' | 'VNIN';
    identityNumber: string;
    legalName: string;
    dateOfBirth?: string;
  }): Promise<IdentityVerificationOutcome> {
    const path =
      input.kind === 'BVN'
        ? `/api/v1/kyc/bvn/full?bvn=${encodeURIComponent(input.identityNumber)}`
        : input.kind === 'NIN'
          ? `/api/v1/kyc/nin?nin=${encodeURIComponent(input.identityNumber)}`
          : `/api/v1/kyc/vnin?vnin=${encodeURIComponent(input.identityNumber)}`;

    const providerReference = randomUUID();
    const entity = await this.get<DojahIdentityEntity>(path, input.kind);
    if (!entity) {
      return {
        provider: this.name,
        providerReference,
        passed: false,
        resultCode: 'NOT_FOUND',
        riskFlags: ['IDENTITY_NOT_FOUND'],
      };
    }

    const verifiedName = [entity.first_name, entity.middle_name, entity.last_name]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' ');

    const riskFlags: string[] = [];
    if (input.dateOfBirth && entity.date_of_birth && entity.date_of_birth !== input.dateOfBirth) {
      riskFlags.push('DOB_MISMATCH');
    }

    return {
      provider: this.name,
      providerReference,
      passed: true,
      resultCode: 'VERIFIED',
      ...(verifiedName ? { verifiedName } : {}),
      riskFlags,
    };
  }

  async listBanks(): Promise<readonly ProviderBank[]> {
    const cached = this.bankCache;
    if (cached && Date.now() - cached.fetchedAt < BANK_LIST_CACHE_TTL_MS) return cached.banks;

    let entities: readonly DojahBankEntity[] | null;
    try {
      entities = await this.get<readonly DojahBankEntity[]>('/api/v1/general/banks', 'BANK_LIST');
    } catch (error) {
      // A stale list beats no list: an outage would otherwise block every
      // account link. Only fail outright when nothing has ever been fetched.
      if (cached) {
        this.logger.warn('Dojah bank list refresh failed; serving cached list');
        return cached.banks;
      }
      throw error;
    }

    const banks = (entities ?? [])
      .map((entity) => ({
        code: entity.nip_code ?? entity.code ?? '',
        name: entity.name ?? '',
      }))
      .filter((bank): bank is ProviderBank => bank.code !== '' && bank.name !== '');

    if (banks.length === 0 && cached) return cached.banks;
    this.bankCache = { banks, fetchedAt: Date.now() };
    return banks;
  }

  async inquireAccount(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<BankAccountInquiryOutcome> {
    const providerReference = randomUUID();
    const entity = await this.get<DojahAccountEntity>(
      `/api/v1/kyc/nuban?bank_code=${encodeURIComponent(input.bankCode)}&account_number=${encodeURIComponent(input.accountNumber)}`,
      'BANK_ACCOUNT',
    );

    if (!entity?.account_name) {
      return {
        provider: this.name,
        providerReference,
        passed: false,
        resultCode: 'NOT_RESOLVED',
        riskFlags: ['ACCOUNT_NOT_RESOLVED'],
      };
    }

    return {
      provider: this.name,
      providerReference,
      passed: true,
      resultCode: 'RESOLVED',
      accountName: entity.account_name,
      riskFlags: [],
    };
  }

  /**
   * @param auditLabel Names the operation for logs. Never the identifier: the
   * query string holds it, so nothing derived from `path` may be logged.
   */
  private async get<T>(path: string, auditLabel: string): Promise<T | null> {
    if (!this.appId || !this.secretKey) {
      throw new ServiceUnavailableException('Identity verification is not configured');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          AppId: this.appId,
          Authorization: this.secretKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // The caught error can embed the request URL, which carries the identity
      // number in its query string, so it is discarded rather than logged.
      this.logger.error(`Dojah request failed (${auditLabel})`);
      throw new ServiceUnavailableException('Identity verification is unavailable');
    }

    // A not-found identifier is a legitimate answer, not a transport failure.
    if (response.status === 404) return null;

    if (!response.ok) {
      this.logger.error(`Dojah rejected the request (${auditLabel}: ${response.status})`);
      throw new ServiceUnavailableException('Identity verification is unavailable');
    }

    const body = (await response.json().catch(() => null)) as DojahEnvelope<T> | null;
    return body?.entity ?? null;
  }
}
