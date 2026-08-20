import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { IdentityProvider } from './identity-provider.js';
import { MockIdentityProvider } from './mock-identity.provider.js';
import {
  SANDBOX_FALLBACK_FLAG,
  SandboxFallbackIdentityProvider,
} from './sandbox-fallback-identity.provider.js';

function primaryWith(overrides: Partial<IdentityProvider>): IdentityProvider {
  return {
    name: 'monnify',
    verifyIdentity: jest.fn().mockResolvedValue({
      provider: 'monnify',
      providerReference: 'ref',
      passed: true,
      resultCode: 'VERIFIED',
      verifiedName: 'Ada Okafor',
      riskFlags: [],
    }),
    listBanks: jest.fn().mockResolvedValue([{ code: '000001', name: 'Real Bank' }]),
    inquireAccount: jest.fn().mockResolvedValue({
      provider: 'monnify',
      providerReference: 'ref',
      passed: true,
      resultCode: 'RESOLVED',
      accountName: 'Ada Okafor',
      riskFlags: [],
    }),
    ...overrides,
  } as IdentityProvider;
}

function build(overrides: Partial<IdentityProvider> = {}) {
  const primary = primaryWith(overrides);
  const mock = new MockIdentityProvider();
  return { provider: new SandboxFallbackIdentityProvider(primary, mock), primary, mock };
}

const INPUT = { kind: 'BVN' as const, identityNumber: '22345678901', legalName: 'Ada Okafor' };

describe('SandboxFallbackIdentityProvider', () => {
  it('passes a real provider result straight through, unflagged', async () => {
    const { provider } = build();
    const result = await provider.verifyIdentity(INPUT);

    expect(result.provider).toBe('monnify');
    expect(result.riskFlags).not.toContain(SANDBOX_FALLBACK_FLAG);
  });

  it('does NOT override a definitive "identity not found"', async () => {
    // The decisive guarantee: the fallback must never turn a real negative
    // verdict into a pass, or it becomes a way to verify any identity.
    const { provider } = build({
      verifyIdentity: jest.fn().mockResolvedValue({
        provider: 'monnify',
        providerReference: 'ref',
        passed: false,
        resultCode: 'NOT_FOUND',
        riskFlags: [],
      }),
    });

    const result = await provider.verifyIdentity({ ...INPUT, identityNumber: '22345670001' });
    expect(result.passed).toBe(false);
    expect(result.resultCode).toBe('NOT_FOUND');
    expect(result.riskFlags).not.toContain(SANDBOX_FALLBACK_FLAG);
  });

  it('falls back when the provider is unavailable, and flags the result', async () => {
    const { provider } = build({
      verifyIdentity: jest.fn().mockRejectedValue(new ServiceUnavailableException('down')),
    });

    const result = await provider.verifyIdentity({ ...INPUT, identityNumber: '22345670001' });
    expect(result.passed).toBe(true);
    expect(result.riskFlags).toContain(SANDBOX_FALLBACK_FLAG);
  });

  it('attributes a fallback result to the mock, never to Monnify', async () => {
    const { provider } = build({
      verifyIdentity: jest.fn().mockRejectedValue(new ServiceUnavailableException('down')),
    });

    const result = await provider.verifyIdentity({ ...INPUT, identityNumber: '22345670001' });
    expect(result.provider).toBe('mock');
  });

  it('keeps the mock strict: a non-test identifier still fails through the fallback', async () => {
    const { provider } = build({
      verifyIdentity: jest.fn().mockRejectedValue(new ServiceUnavailableException('down')),
    });

    // Does not end in 0001, so even the fallback refuses it.
    const result = await provider.verifyIdentity(INPUT);
    expect(result.passed).toBe(false);
  });

  it('falls back for vNIN, which the sandbox cannot serve', async () => {
    const { provider } = build({
      verifyIdentity: jest.fn().mockResolvedValue({
        provider: 'monnify',
        providerReference: 'ref',
        passed: false,
        resultCode: 'UNSUPPORTED_IDENTITY_TYPE',
        riskFlags: ['UNSUPPORTED_IDENTITY_TYPE'],
      }),
    });

    const result = await provider.verifyIdentity({
      kind: 'VNIN',
      identityNumber: 'AB12CD34EF560001',
      legalName: 'Ada Okafor',
    });
    expect(result.passed).toBe(true);
    expect(result.riskFlags).toContain(SANDBOX_FALLBACK_FLAG);
  });

  it('does not swallow a programming error, only provider unavailability', async () => {
    const { provider } = build({
      verifyIdentity: jest.fn().mockRejectedValue(new BadRequestException('bad input')),
    });

    await expect(provider.verifyIdentity(INPUT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falls back to the mock bank list when the real list is unavailable', async () => {
    const { provider } = build({
      listBanks: jest.fn().mockRejectedValue(new ServiceUnavailableException('down')),
    });

    const banks = await provider.listBanks();
    expect(banks.length).toBeGreaterThan(0);
    expect(banks[0]?.name).toContain('Mock');
  });

  it('falls back when the real bank list comes back empty', async () => {
    const { provider } = build({ listBanks: jest.fn().mockResolvedValue([]) });
    expect((await provider.listBanks()).length).toBeGreaterThan(0);
  });

  it('flags a fallback account inquiry', async () => {
    const { provider } = build({
      inquireAccount: jest.fn().mockRejectedValue(new ServiceUnavailableException('down')),
    });

    const result = await provider.inquireAccount({
      bankCode: '000001',
      accountNumber: '0123450001',
    });
    expect(result.passed).toBe(true);
    expect(result.riskFlags).toContain(SANDBOX_FALLBACK_FLAG);
    expect(result.provider).toBe('mock');
  });
});
