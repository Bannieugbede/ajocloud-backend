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

const DEFAULT_BASE_URL = 'https://api.monnify.com';
const REQUEST_TIMEOUT_MS = 20_000;
/** Renew slightly early so a token cannot expire mid-flight. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** Every Monnify response is wrapped in this envelope. */
interface MonnifyEnvelope<T> {
  readonly requestSuccessful?: boolean;
  readonly responseMessage?: string;
  readonly responseCode?: string;
  readonly responseBody?: T;
}

interface MonnifyLoginBody {
  readonly accessToken?: string;
  readonly expiresIn?: number;
}

interface MonnifyBvnBody {
  readonly name?: string;
  readonly dateOfBirth?: string;
  readonly mobileNo?: string;
  /** Present on the match endpoints: "FULL_MATCH" | "PARTIAL_MATCH" | "NO_MATCH". */
  readonly bvn?: string;
}

interface MonnifyNinBody {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly middleName?: string;
  readonly dateOfBirth?: string;
}

interface MonnifyAccountBody {
  readonly accountName?: string;
  readonly accountNumber?: string;
  readonly bankCode?: string;
}

interface MonnifyBankBody {
  readonly code?: string;
  readonly name?: string;
  readonly nipBankCode?: string;
}

/**
 * Monnify identity verification (ADR-005).
 *
 * Monnify is the single provider for payments, verification, and payouts. This
 * adapter covers the verification surface: BVN, NIN, bank list, and account
 * name inquiry.
 *
 * The identity number is sent to Monnify over TLS and is never stored, logged,
 * or included in any error this class raises. Errors deliberately carry only a
 * status code, because a transport error object can hold the request body.
 */
@Injectable()
export class MonnifyIdentityProvider implements IdentityProvider {
  readonly name = 'monnify';

  private readonly logger = new Logger(MonnifyIdentityProvider.name);
  private readonly apiKey: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly baseUrl: string;
  private bankCache: { banks: readonly ProviderBank[]; fetchedAt: number } | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  /** Single-flight guard so concurrent calls share one login round trip. */
  private tokenRequest: Promise<string> | null = null;

  constructor(config: ConfigService<Environment, true>) {
    this.apiKey = config.get('MONNIFY_API_KEY', { infer: true }) || undefined;
    this.secretKey = config.get('MONNIFY_SECRET_KEY', { infer: true }) || undefined;
    this.baseUrl = (config.get('MONNIFY_BASE_URL', { infer: true }) || DEFAULT_BASE_URL).replace(
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
    const providerReference = randomUUID();

    // Monnify has no vNIN endpoint. Refusing is the honest answer: silently
    // treating a vNIN as a NIN would send a 16-character token to an endpoint
    // that expects 11 digits and report the rejection as a failed identity.
    if (input.kind === 'VNIN') {
      return {
        provider: this.name,
        providerReference,
        passed: false,
        resultCode: 'UNSUPPORTED_IDENTITY_TYPE',
        riskFlags: ['UNSUPPORTED_IDENTITY_TYPE'],
      };
    }

    const entity =
      input.kind === 'BVN'
        ? await this.post<MonnifyBvnBody>(
            '/api/v1/vas/bvn-details',
            { bvn: input.identityNumber },
            'BVN',
          )
        : await this.post<MonnifyNinBody>(
            '/api/v1/vas/nin-details',
            { nin: input.identityNumber },
            'NIN',
          );

    if (!entity) {
      return {
        provider: this.name,
        providerReference,
        passed: false,
        resultCode: 'NOT_FOUND',
        riskFlags: ['IDENTITY_NOT_FOUND'],
      };
    }

    const verifiedName =
      'name' in entity && typeof entity.name === 'string' && entity.name.length > 0
        ? entity.name
        : [
            (entity as MonnifyNinBody).firstName,
            (entity as MonnifyNinBody).middleName,
            (entity as MonnifyNinBody).lastName,
          ]
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
            .join(' ');

    const riskFlags: string[] = [];
    if (input.dateOfBirth && entity.dateOfBirth && entity.dateOfBirth !== input.dateOfBirth) {
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

    let entities: readonly MonnifyBankBody[] | null;
    try {
      entities = await this.get<readonly MonnifyBankBody[]>('/api/v1/banks', 'BANK_LIST');
    } catch (error) {
      // A stale list beats no list: an outage would otherwise block every
      // account link. Only fail outright when nothing has ever been fetched.
      if (cached) {
        this.logger.warn('Monnify bank list refresh failed; serving cached list');
        return cached.banks;
      }
      throw error;
    }

    const banks = (entities ?? [])
      .map((entity) => ({
        code: entity.nipBankCode ?? entity.code ?? '',
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
    const entity = await this.get<MonnifyAccountBody>(
      `/api/v1/disbursements/account/validate?accountNumber=${encodeURIComponent(input.accountNumber)}&bankCode=${encodeURIComponent(input.bankCode)}`,
      'BANK_ACCOUNT',
    );

    if (!entity?.accountName) {
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
      accountName: entity.accountName,
      riskFlags: [],
    };
  }

  /**
   * Monnify issues a bearer token from the Basic-authenticated login endpoint.
   * The token is cached until shortly before it expires.
   */
  private async authenticate(): Promise<string> {
    if (!this.apiKey || !this.secretKey) {
      throw new ServiceUnavailableException('Identity verification is not configured');
    }

    const cached = this.token;
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    if (this.tokenRequest) return this.tokenRequest;

    const basic = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');
    this.tokenRequest = (async () => {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // The caught error can embed the Authorization header, so it is
        // discarded rather than logged.
        this.logger.error('Monnify authentication request failed');
        throw new ServiceUnavailableException('Identity verification is unavailable');
      }

      if (!response.ok) {
        this.logger.error(`Monnify authentication rejected (${response.status})`);
        throw new ServiceUnavailableException('Identity verification is unavailable');
      }

      const body = (await response
        .json()
        .catch(() => null)) as MonnifyEnvelope<MonnifyLoginBody> | null;
      const accessToken = body?.responseBody?.accessToken;
      if (!accessToken) {
        this.logger.error('Monnify authentication returned no token');
        throw new ServiceUnavailableException('Identity verification is unavailable');
      }

      const expiresInMs = (body.responseBody?.expiresIn ?? 3_600) * 1_000;
      this.token = {
        value: accessToken,
        expiresAt: Date.now() + Math.max(expiresInMs - TOKEN_EXPIRY_SKEW_MS, 0),
      };
      return accessToken;
    })().finally(() => {
      this.tokenRequest = null;
    });

    return this.tokenRequest;
  }

  private get<T>(path: string, auditLabel: string): Promise<T | null> {
    return this.request<T>('GET', path, undefined, auditLabel);
  }

  private post<T>(
    path: string,
    payload: Record<string, string>,
    auditLabel: string,
  ): Promise<T | null> {
    return this.request<T>('POST', path, payload, auditLabel);
  }

  /**
   * @param auditLabel Names the operation for logs. Never the identifier:
   * `path` and `payload` both hold it, so nothing derived from them may be
   * logged.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    payload: Record<string, string> | undefined,
    auditLabel: string,
  ): Promise<T | null> {
    const token = await this.authenticate();

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // The caught error can embed the request URL and body, which carry the
      // identity number, so it is discarded rather than logged.
      this.logger.error(`Monnify request failed (${auditLabel})`);
      throw new ServiceUnavailableException('Identity verification is unavailable');
    }

    // An unknown identifier is a legitimate answer, not a transport failure.
    if (response.status === 404) return null;

    if (!response.ok) {
      this.logger.error(`Monnify rejected the request (${auditLabel}: ${response.status})`);
      throw new ServiceUnavailableException('Identity verification is unavailable');
    }

    const body = (await response.json().catch(() => null)) as MonnifyEnvelope<T> | null;
    // Monnify signals a business-level failure inside a 200 response.
    if (body?.requestSuccessful === false) return null;
    return body?.responseBody ?? null;
  }
}
