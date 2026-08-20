import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/env.schema.js';
import { MonnifyIdentityProvider } from './monnify-identity.provider.js';

const BVN = '22345678901';

function buildConfig(overrides: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    MONNIFY_BASE_URL: 'https://sandbox.monnify.test',
    MONNIFY_API_KEY: 'api-key',
    MONNIFY_SECRET_KEY: 'secret-key',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Environment, true>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const loginResponse = () =>
  jsonResponse({
    requestSuccessful: true,
    responseBody: { accessToken: 'bearer-token', expiresIn: 3600 },
  });

describe('MonnifyIdentityProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('authenticates once and reuses the token', async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        jsonResponse({ requestSuccessful: true, responseBody: { name: 'Ada Okafor' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ requestSuccessful: true, responseBody: { name: 'Ada Okafor' } }),
      );

    const provider = new MonnifyIdentityProvider(buildConfig());
    await provider.verifyIdentity({ kind: 'BVN', identityNumber: BVN, legalName: 'Ada Okafor' });
    await provider.verifyIdentity({ kind: 'BVN', identityNumber: BVN, legalName: 'Ada Okafor' });

    const calls = fetchMock.mock.calls as [string][];
    const loginCalls = calls.filter(([url]) => url.endsWith('/api/v1/auth/login'));
    expect(loginCalls).toHaveLength(1);
  });

  it('returns the verified name from a BVN lookup', async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        jsonResponse({ requestSuccessful: true, responseBody: { name: 'Ada Okafor' } }),
      );

    const provider = new MonnifyIdentityProvider(buildConfig());
    const result = await provider.verifyIdentity({
      kind: 'BVN',
      identityNumber: BVN,
      legalName: 'Ada Okafor',
    });

    expect(result.passed).toBe(true);
    expect(result.verifiedName).toBe('Ada Okafor');
    expect(result.provider).toBe('monnify');
  });

  it('refuses vNIN without calling the provider', async () => {
    fetchMock.mockResolvedValue(loginResponse());
    const provider = new MonnifyIdentityProvider(buildConfig());

    const result = await provider.verifyIdentity({
      kind: 'VNIN',
      identityNumber: 'AB12CD34EF56GH78',
      legalName: 'Ada Okafor',
    });

    expect(result.passed).toBe(false);
    expect(result.resultCode).toBe('UNSUPPORTED_IDENTITY_TYPE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a business-level failure as not found rather than a pass', async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        jsonResponse({ requestSuccessful: false, responseMessage: 'no record' }),
      );

    const provider = new MonnifyIdentityProvider(buildConfig());
    const result = await provider.verifyIdentity({
      kind: 'BVN',
      identityNumber: BVN,
      legalName: 'Ada Okafor',
    });

    expect(result.passed).toBe(false);
    expect(result.resultCode).toBe('NOT_FOUND');
  });

  it('never leaks the identity number in a transport failure', async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockRejectedValueOnce(new Error(`connect failed to /api/v1/vas/bvn-details?bvn=${BVN}`));

    const provider = new MonnifyIdentityProvider(buildConfig());
    const error = await provider
      .verifyIdentity({ kind: 'BVN', identityNumber: BVN, legalName: 'Ada Okafor' })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    // The rejected fetch error carried the identifier; nothing rethrown may.
    expect((error as Error).message).not.toContain(BVN);
    expect((error as Error).stack ?? '').not.toContain(BVN);
    expect(JSON.stringify(error)).not.toContain(BVN);
  });

  it('refuses to call the provider when credentials are absent', async () => {
    const provider = new MonnifyIdentityProvider(
      buildConfig({ MONNIFY_API_KEY: '', MONNIFY_SECRET_KEY: '' }),
    );

    await expect(provider.listBanks()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves the cached bank list when a refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(loginResponse()).mockResolvedValueOnce(
      jsonResponse({
        requestSuccessful: true,
        responseBody: [{ name: 'Test Bank', nipBankCode: '000001' }],
      }),
    );

    const provider = new MonnifyIdentityProvider(buildConfig());
    const first = await provider.listBanks();
    expect(first).toEqual([{ code: '000001', name: 'Test Bank' }]);

    // Expire the cache, then fail the refresh.
    (provider as unknown as { bankCache: { fetchedAt: number } }).bankCache.fetchedAt = 0;
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    expect(await provider.listBanks()).toEqual(first);
  });

  it('resolves an account name from the bank', async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        jsonResponse({ requestSuccessful: true, responseBody: { accountName: 'Ada Okafor' } }),
      );

    const provider = new MonnifyIdentityProvider(buildConfig());
    const result = await provider.inquireAccount({
      bankCode: '000001',
      accountNumber: '0123456789',
    });

    expect(result.passed).toBe(true);
    expect(result.accountName).toBe('Ada Okafor');
  });
});
