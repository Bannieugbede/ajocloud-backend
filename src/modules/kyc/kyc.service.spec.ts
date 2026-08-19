import { BadRequestException, HttpException } from '@nestjs/common';
import { KycService } from './kyc.service.js';
import { IdentityKindInput, type VerifyIdentityDto } from './dto/verify-identity.dto.js';
import type { IdentityProvider } from './providers/identity-provider.js';

const BVN = '22345678901';
const ACCOUNT_NUMBER = '0123456789';
const PEPPER = 'test-pepper-value-at-least-32-characters';

type MockProvider = IdentityProvider & {
  verifyIdentity: jest.Mock;
  listBanks: jest.Mock;
  inquireAccount: jest.Mock;
};

function buildProvider(overrides: Partial<IdentityProvider> = {}): MockProvider {
  return {
    name: 'mock',
    verifyIdentity: jest.fn().mockResolvedValue({
      provider: 'mock',
      providerReference: 'provider-ref',
      passed: true,
      resultCode: 'VERIFIED',
      verifiedName: 'Ada Okafor',
      riskFlags: [],
    }),
    listBanks: jest.fn().mockResolvedValue([{ code: '000001', name: 'Test Bank' }]),
    inquireAccount: jest.fn().mockResolvedValue({
      provider: 'mock',
      providerReference: 'account-ref',
      passed: true,
      resultCode: 'RESOLVED',
      accountName: 'Ada Okafor',
      riskFlags: [],
    }),
    ...overrides,
  } as MockProvider;
}

function build(options: { provider?: MockProvider; failures?: { createdAt: Date }[] } = {}) {
  const profile = {
    userId: 'user-1',
    firstName: 'Ada',
    lastName: 'Okafor',
    dateOfBirth: new Date('1995-01-01'),
    gender: 'FEMALE',
    addressLine: '12 Marina Road',
    city: 'Lagos',
    state: 'Lagos',
    occupation: 'Trader',
  };
  const prisma = {
    userProfile: {
      findUnique: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockResolvedValue(profile),
    },
    kycProfile: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'kyc-1',
        tier: 'TIER_1',
        status: 'PENDING',
        checks: [],
      }),
      upsert: jest.fn().mockResolvedValue({ id: 'kyc-1', tier: 'TIER_1', status: 'PENDING' }),
      update: jest.fn().mockResolvedValue({}),
    },
    kycCheck: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(options.failures ?? []),
    },
    userConsent: { upsert: jest.fn().mockResolvedValue({}) },
    linkedBankAccount: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(PEPPER) };
  const provider = options.provider ?? buildProvider();
  const service = new KycService(prisma as never, audit as never, config as never, provider);
  return { service, prisma, audit, provider };
}

function verifyDto(overrides: Partial<VerifyIdentityDto> = {}): VerifyIdentityDto {
  return {
    kind: IdentityKindInput.BVN,
    identityNumber: BVN,
    consent: true,
    ...overrides,
  } as VerifyIdentityDto;
}

/** Everything written to the database, as one searchable string. */
function everythingPersisted(prisma: ReturnType<typeof build>['prisma']): string {
  const writes: jest.Mock[] = [
    prisma.kycCheck.create,
    prisma.kycProfile.upsert,
    prisma.kycProfile.update,
    prisma.userConsent.upsert,
    prisma.linkedBankAccount.upsert,
    prisma.userProfile.update,
  ];
  return writes.map((write) => JSON.stringify(write.mock.calls)).join('');
}

describe('KycService identity verification', () => {
  it('never persists the raw identity number', async () => {
    const { service, prisma, audit } = build();
    await service.verifyIdentity('user-1', verifyDto());

    expect(everythingPersisted(prisma)).not.toContain(BVN);
    // The audit trail must not carry it either.
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(BVN);
  });

  it('stores only the masked identifier', async () => {
    const { service, prisma } = build();
    await service.verifyIdentity('user-1', verifyDto());

    const [call] = prisma.kycCheck.create.mock.calls as [[{ data: { maskedIdentifier: string } }]];
    expect(call[0].data.maskedIdentifier).toBe('*******8901');
  });

  it('records consent before the provider is called', async () => {
    const { service, prisma, provider } = build();
    await service.verifyIdentity('user-1', verifyDto());

    expect(prisma.userConsent.upsert).toHaveBeenCalled();
    const consentOrder = prisma.userConsent.upsert.mock.invocationCallOrder[0] ?? 0;
    const providerOrder = (provider.verifyIdentity as jest.Mock).mock.invocationCallOrder[0] ?? 0;
    expect(consentOrder).toBeLessThan(providerOrder);
  });

  it('rejects a malformed number without calling the provider', async () => {
    const { service, provider } = build();
    await expect(
      service.verifyIdentity('user-1', verifyDto({ identityNumber: '123' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.verifyIdentity).not.toHaveBeenCalled();
  });

  it('flags a name mismatch for review rather than rejecting it', async () => {
    const provider = buildProvider({
      verifyIdentity: jest.fn().mockResolvedValue({
        provider: 'mock',
        providerReference: 'provider-ref',
        passed: true,
        resultCode: 'VERIFIED',
        verifiedName: 'Tunde Balogun',
        riskFlags: [],
      }),
    });
    const { service, prisma } = build({ provider });

    const result = await service.verifyIdentity('user-1', verifyDto());
    expect(result.requiresReview).toBe(true);

    const [call] = prisma.kycCheck.create.mock.calls as [[{ data: { riskFlags: string[] } }]];
    expect(call[0].data.riskFlags).toContain('NAME_MISMATCH');
    const [review] = prisma.kycProfile.update.mock.calls as [[{ data: { status: string } }]];
    expect(review[0].data.status).toBe('REQUIRES_REVIEW');
  });

  it('records a failed check and refuses, without storing the number', async () => {
    const provider = buildProvider({
      verifyIdentity: jest.fn().mockResolvedValue({
        provider: 'mock',
        providerReference: 'provider-ref',
        passed: false,
        resultCode: 'NOT_FOUND',
        riskFlags: [],
      }),
    });
    const { service, prisma } = build({ provider });

    await expect(service.verifyIdentity('user-1', verifyDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.kycCheck.create).toHaveBeenCalled();
    expect(everythingPersisted(prisma)).not.toContain(BVN);
  });

  it('refuses once the attempt budget is spent', async () => {
    const failures = Array.from({ length: 5 }, () => ({ createdAt: new Date() }));
    const { service, provider } = build({ failures });

    const verify = provider.verifyIdentity;
    await expect(service.verifyIdentity('user-1', verifyDto())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('KycService bank accounts', () => {
  it('resolves a name without storing anything', async () => {
    const { service, prisma } = build();
    const result = await service.inquireAccount({
      bankCode: '000001',
      accountNumber: ACCOUNT_NUMBER,
    });

    expect(result.accountName).toBe('Ada Okafor');
    expect(prisma.linkedBankAccount.upsert).not.toHaveBeenCalled();
  });

  it('stores the account number masked and digested, never in full', async () => {
    const { service, prisma } = build();
    await service.linkBankAccount('user-1', {
      bankCode: '000001',
      accountNumber: ACCOUNT_NUMBER,
    });

    const [call] = prisma.linkedBankAccount.upsert.mock.calls as [
      [{ create: { accountMasked: string; accountDigest: string } }],
    ];
    expect(call[0].create.accountMasked).toBe('******6789');
    expect(call[0].create.accountDigest).not.toContain(ACCOUNT_NUMBER);
    expect(everythingPersisted(prisma)).not.toContain(ACCOUNT_NUMBER);
  });

  it('uses the name the bank returned, not one the user supplies', async () => {
    const { service, prisma } = build();
    await service.linkBankAccount('user-1', {
      bankCode: '000001',
      accountNumber: ACCOUNT_NUMBER,
    });

    const [call] = prisma.linkedBankAccount.upsert.mock.calls as [
      [{ create: { accountName: string } }],
    ];
    expect(call[0].create.accountName).toBe('Ada Okafor');
  });

  it('refuses a bank that is not in the provider list', async () => {
    const { service } = build();
    await expect(
      service.linkBankAccount('user-1', { bankCode: '999999', accountNumber: ACCOUNT_NUMBER }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an account the provider cannot resolve', async () => {
    const provider = buildProvider({
      inquireAccount: jest.fn().mockResolvedValue({
        provider: 'mock',
        providerReference: 'account-ref',
        passed: false,
        resultCode: 'NOT_RESOLVED',
        riskFlags: [],
      }),
    });
    const { service } = build({ provider });
    await expect(
      service.inquireAccount({ bankCode: '000001', accountNumber: ACCOUNT_NUMBER }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never returns the account digest to the client', async () => {
    const { service, prisma } = build();
    await service.listBankAccounts('user-1');

    const [call] = prisma.linkedBankAccount.findMany.mock.calls as [
      [{ select: Record<string, boolean> }],
    ];
    expect(call[0].select.accountDigest).toBeUndefined();
  });
});

describe('KycService personal details', () => {
  it('refuses someone under eighteen', async () => {
    const { service, prisma } = build();
    await expect(
      service.updatePersonalDetails('user-1', {
        dateOfBirth: new Date('2015-01-01'),
        gender: 'FEMALE',
        addressLine: '12 Marina Road',
        city: 'Lagos',
        state: 'Lagos',
        occupation: 'Trader',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userProfile.update).not.toHaveBeenCalled();
  });
});
