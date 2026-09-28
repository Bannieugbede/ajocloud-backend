import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
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

type FactsSeed = {
  basicInfo?: boolean;
  pin?: boolean;
  checks?: { type: string; status: string; createdAt?: Date }[];
  documents?: { id: string }[];
};

function build(
  options: {
    provider?: MockProvider;
    failures?: { createdAt: Date }[];
    facts?: FactsSeed;
    ninSummary?: unknown;
  } = {},
) {
  const facts = {
    basicInfo: true,
    pin: true,
    checks: [] as { type: string; status: string; createdAt?: Date }[],
    documents: [] as { id: string }[],
    ...options.facts,
  };
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
    // What readKycFacts sees.
    user: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          status: 'ACTIVE',
          profile: facts.basicInfo ? profile : { ...profile, occupation: null },
          transactionPin: facts.pin ? { id: 'pin-1' } : null,
          kycProfile: {
            status: 'PENDING',
            restrictedAt: null,
            checks: facts.checks.map((check) => ({ createdAt: new Date(), ...check })),
            documents: facts.documents,
          },
        }),
      ),
    },
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
      create: jest.fn().mockResolvedValue({}),
    },
    kycCheck: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(options.failures ?? []),
      findFirst: jest.fn().mockResolvedValue({
        provider: 'mock',
        resultSummary: options.ninSummary ?? null,
      }),
    },
    verificationDocument: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'doc-1', type: 'NIN_SLIP', createdAt: new Date() }),
    },
    // Runs the callback against this same mock, as a transaction client.
    $transaction: jest.fn(<T>(operation: (tx: unknown) => Promise<T>): Promise<T> =>
      operation(client()),
    ),
    userConsent: { upsert: jest.fn().mockResolvedValue({}) },
    linkedBankAccount: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const client = (): unknown => prisma;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(PEPPER) };
  const provider = options.provider ?? buildProvider();
  const service = new KycService(prisma as never, audit as never, config as never, provider);
  return { service, prisma, audit, provider, facts };
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
    prisma.verificationDocument.create,
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

const NIN = '12345670001';

describe('KycService staged NIN verification', () => {
  const nin = (overrides: Partial<VerifyIdentityDto> = {}) =>
    verifyDto({ kind: IdentityKindInput.NIN, identityNumber: NIN, ...overrides });

  it('refuses a NIN before stage 1 is complete, without calling the provider', async () => {
    const { service, provider } = build({ facts: { basicInfo: false } });
    const failure = service.verifyIdentity('user-1', nin());
    await expect(failure).rejects.toBeInstanceOf(ForbiddenException);
    await expect(failure).rejects.toMatchObject({
      response: { code: 'KYC_STAGE_REQUIRED', details: { requiredStage: 1 } },
    });
    expect(provider.verifyIdentity).not.toHaveBeenCalled();
  });

  it('refuses a second NIN once one is verified', async () => {
    const { service, provider } = build({ facts: { checks: [{ type: 'NIN', status: 'PASSED' }] } });
    await expect(service.verifyIdentity('user-1', nin())).rejects.toBeInstanceOf(ConflictException);
    expect(provider.verifyIdentity).not.toHaveBeenCalled();
  });

  it('holds a name mismatch for a reviewer instead of passing it', async () => {
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
    await service.verifyIdentity('user-1', nin());
    const [call] = prisma.kycCheck.create.mock.calls as [[{ data: { status: string } }]];
    expect(call[0].data.status).toBe('PENDING');
  });

  it('keeps the address on the NIN record for stage 3, never the number', async () => {
    const provider = buildProvider({
      verifyIdentity: jest.fn().mockResolvedValue({
        provider: 'mock',
        providerReference: 'provider-ref',
        passed: true,
        resultCode: 'VERIFIED',
        verifiedName: 'Ada Okafor',
        registeredAddress: { line: '1 Mock Street', state: 'Lagos' },
        riskFlags: [],
      }),
    });
    const { service, prisma } = build({ provider });
    await service.verifyIdentity('user-1', nin());
    const [call] = prisma.kycCheck.create.mock.calls as [
      [{ data: { status: string; resultSummary: unknown } }],
    ];
    expect(call[0].data.status).toBe('PASSED');
    expect(call[0].data.resultSummary).toEqual({
      registeredAddress: { line: '1 Mock Street', state: 'Lagos' },
    });
    expect(everythingPersisted(prisma)).not.toContain(NIN);
  });
});

describe('KycService NIN document', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x10, 0x20, 0x30, 0x40]);
  const upload = {
    type: 'NIN_SLIP' as const,
    contentType: 'image/jpeg',
    data: jpeg.toString('base64'),
  };

  it('refuses a document before the NIN is verified', async () => {
    const { service, prisma } = build();
    await expect(service.uploadIdentityDocument('user-1', upload)).rejects.toMatchObject({
      response: { code: 'KYC_STAGE_REQUIRED' },
    });
    expect(prisma.verificationDocument.create).not.toHaveBeenCalled();
  });

  it('stores the file encrypted, replacing an earlier upload', async () => {
    const { service, prisma } = build({ facts: { checks: [{ type: 'NIN', status: 'PASSED' }] } });
    await service.uploadIdentityDocument('user-1', upload);

    expect(prisma.verificationDocument.updateMany).toHaveBeenCalled();
    const [call] = prisma.verificationDocument.create.mock.calls as [
      [{ data: { ciphertext: Uint8Array; contentType: string } }],
    ];
    expect(call[0].data.contentType).toBe('image/jpeg');
    expect(Buffer.from(call[0].data.ciphertext).includes(jpeg)).toBe(false);
  });

  it('refuses a file that is not what it claims', async () => {
    const { service } = build({ facts: { checks: [{ type: 'NIN', status: 'PASSED' }] } });
    await expect(
      service.uploadIdentityDocument('user-1', { ...upload, contentType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the document fixed once stage 2 is complete', async () => {
    const { service } = build({
      facts: { checks: [{ type: 'NIN', status: 'PASSED' }], documents: [{ id: 'doc-0' }] },
    });
    await expect(service.uploadIdentityDocument('user-1', upload)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('KycService address verification', () => {
  const stage2 = { checks: [{ type: 'NIN', status: 'PASSED' }], documents: [{ id: 'doc-0' }] };
  const record = { registeredAddress: { line: '1 Mock Street', city: 'Ikeja', state: 'Lagos' } };
  const address = { addressLine: 'No. 1, Mock St', city: 'Ikeja', state: 'Lagos State' };

  const writtenCheck = (prisma: ReturnType<typeof build>['prisma']) =>
    (prisma.kycCheck.create.mock.calls as [[{ data: { type: string; status: string } }]])[0][0]
      .data;

  it('refuses before stage 2 is complete', async () => {
    const { service } = build({ facts: { checks: [{ type: 'NIN', status: 'PASSED' }] } });
    await expect(service.verifyAddress('user-1', address)).rejects.toMatchObject({
      response: { code: 'KYC_STAGE_REQUIRED', details: { requiredStage: 2 } },
    });
  });

  it('passes an address that matches the NIN record', async () => {
    const { service, prisma } = build({ facts: stage2, ninSummary: record });
    await expect(service.verifyAddress('user-1', address)).resolves.toEqual({ status: 'VERIFIED' });
    expect(writtenCheck(prisma)).toMatchObject({ type: 'ADDRESS', status: 'PASSED' });
  });

  it('fails an address that does not match, and says which part', async () => {
    const { service, prisma } = build({ facts: stage2, ninSummary: record });
    const failure = service.verifyAddress('user-1', { ...address, state: 'Ogun' });
    await expect(failure).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(failure).rejects.toThrow(/state/);
    expect(writtenCheck(prisma)).toMatchObject({ type: 'ADDRESS', status: 'FAILED' });
  });

  it('sends the address to a reviewer when the record has none', async () => {
    const { service, prisma } = build({ facts: stage2, ninSummary: null });
    await expect(service.verifyAddress('user-1', address)).resolves.toEqual({
      status: 'UNDER_REVIEW',
    });
    expect(writtenCheck(prisma)).toMatchObject({ type: 'ADDRESS', status: 'PENDING' });
    const updates = prisma.kycProfile.update.mock.calls as [[{ data: { status?: string } }]];
    expect(updates.some(([args]) => args.data.status === 'REQUIRES_REVIEW')).toBe(true);
  });

  it('refuses a second attempt while one is under review', async () => {
    const { service } = build({
      facts: { ...stage2, checks: [...stage2.checks, { type: 'ADDRESS', status: 'PENDING' }] },
    });
    await expect(service.verifyAddress('user-1', address)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
