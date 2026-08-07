import { hash, argon2id } from 'argon2';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  AccountType,
  AjoContributionMode,
  AjoCycleStatus,
  AjoGroupStatus,
  AjoMemberRole,
  AjoMemberStatus,
  AjoSlotStatus,
  BillCatalogStatus,
  BillPaymentStatus,
  ContributionFrequency,
  FinancialAccountPurpose,
  FoodAjoStatus,
  FoodCoordinatorApplicationStatus,
  FoodFulfilmentMethod,
  FoodSubscriptionStatus,
  KycCheckStatus,
  KycStatus,
  KycTier,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  ReconciliationState,
  SavingsGoalStatus,
  SavingsGoalType,
  SavingsScheduleStatus,
  UserStatus,
  VerificationType,
} from '../../../generated/prisma/enums.js';

/**
 * Deterministic, clearly fake admin-demo data for the admin console.
 * Never add real identity or financial data here.
 */

const userSeed = [
  {
    id: '40000000-0000-4000-8000-000000000003',
    email: 'bisi.adeyemi@example.test',
    phone: '+2348020000003',
    status: UserStatus.ACTIVE,
    firstName: 'Bisi',
    lastName: 'Adeyemi',
    kyc: { status: KycStatus.VERIFIED, tier: KycTier.TIER_2, level: 2 },
  },
  {
    id: '40000000-0000-4000-8000-000000000004',
    email: 'chidi.nwosu@example.test',
    phone: '+2348020000004',
    status: UserStatus.ACTIVE,
    firstName: 'Chidi',
    lastName: 'Nwosu',
    kyc: { status: KycStatus.VERIFIED, tier: KycTier.TIER_1, level: 1 },
  },
  {
    id: '40000000-0000-4000-8000-000000000005',
    email: 'emeka.obi@example.test',
    phone: '+2348020000005',
    status: UserStatus.ACTIVE,
    firstName: 'Emeka',
    lastName: 'Obi',
    kyc: { status: KycStatus.VERIFIED, tier: KycTier.TIER_3, level: 3 },
  },
  {
    id: '40000000-0000-4000-8000-000000000006',
    email: 'fatima.bello@example.test',
    phone: '+2348020000006',
    status: UserStatus.ACTIVE,
    firstName: 'Fatima',
    lastName: 'Bello',
    kyc: { status: KycStatus.PENDING, tier: KycTier.TIER_2, level: 2 },
  },
  {
    id: '40000000-0000-4000-8000-000000000007',
    email: 'tunde.balogun@example.test',
    phone: '+2348020000007',
    status: UserStatus.SUSPENDED,
    firstName: 'Tunde',
    lastName: 'Balogun',
    kyc: { status: KycStatus.REQUIRES_REVIEW, tier: KycTier.TIER_1, level: 1 },
  },
  {
    id: '40000000-0000-4000-8000-000000000008',
    email: 'amara.okafor@example.test',
    phone: '+2348020000008',
    status: UserStatus.PENDING_VERIFICATION,
    firstName: 'Amara',
    lastName: 'Okafor',
    kyc: { status: KycStatus.NOT_STARTED, tier: KycTier.TIER_1, level: 1 },
  },
  {
    id: '40000000-0000-4000-8000-000000000009',
    email: 'kunle.adeleke@example.test',
    phone: '+2348020000009',
    status: UserStatus.ACTIVE,
    firstName: 'Kunle',
    lastName: 'Adeleke',
    kyc: { status: KycStatus.VERIFIED, tier: KycTier.TIER_3, level: 3 },
  },
] as const;

const goalSeed = [
  {
    id: '30000000-0000-4000-8000-000000000011',
    userId: '40000000-0000-4000-8000-000000000003',
    name: 'School Fees',
    type: SavingsGoalType.TARGET,
    targetMinor: 400_000_00n,
    status: SavingsGoalStatus.ACTIVE,
  },
  {
    id: '30000000-0000-4000-8000-000000000012',
    userId: '40000000-0000-4000-8000-000000000004',
    name: 'Emergency Fund',
    type: SavingsGoalType.FLEXIBLE,
    targetMinor: 150_000_00n,
    status: SavingsGoalStatus.ACTIVE,
  },
  {
    id: '30000000-0000-4000-8000-000000000013',
    userId: '40000000-0000-4000-8000-000000000005',
    name: 'New Generator',
    type: SavingsGoalType.LOCKED,
    targetMinor: 750_000_00n,
    status: SavingsGoalStatus.ACTIVE,
  },
  {
    id: '30000000-0000-4000-8000-000000000014',
    userId: '40000000-0000-4000-8000-000000000007',
    name: 'Business Stock',
    type: SavingsGoalType.TARGET,
    targetMinor: 1_000_000_00n,
    status: SavingsGoalStatus.PAUSED,
  },
] as const;

const programmeSeed = [
  {
    id: '20000000-0000-4000-8000-000000000011',
    coordinatorUserId: '40000000-0000-4000-8000-000000000005',
    name: 'Community Rice & Beans Pool',
    status: FoodAjoStatus.OPEN,
    contributionMinor: 20_000_00n,
    startsAt: '2026-08-01',
    endsAt: '2026-11-30',
    package: {
      id: '20000000-0000-4000-8000-000000000012',
      name: 'Family Essentials Basket',
      priceMinor: 60_000_00n,
    },
    items: [
      { name: 'Rice', quantity: '20.000', unit: 'kg' },
      { name: 'Beans', quantity: '10.000', unit: 'kg' },
      { name: 'Palm Oil', quantity: '4.000', unit: 'L' },
    ],
  },
  {
    id: '20000000-0000-4000-8000-000000000013',
    coordinatorUserId: '40000000-0000-4000-8000-000000000009',
    name: 'Estate Grocery Programme',
    status: FoodAjoStatus.ACTIVE,
    contributionMinor: 35_000_00n,
    startsAt: '2026-07-01',
    endsAt: '2026-12-31',
    package: {
      id: '20000000-0000-4000-8000-000000000014',
      name: 'Monthly Provisions Box',
      priceMinor: 105_000_00n,
    },
    items: [
      { name: 'Tomato Paste', quantity: '12.000', unit: 'can' },
      { name: 'Noodles', quantity: '24.000', unit: 'pack' },
      { name: 'Sugar', quantity: '5.000', unit: 'kg' },
    ],
  },
] as const;

export async function seedAdminDemo(prisma: PrismaClient): Promise<void> {
  const passwordHash = await hash('Development-Only-Password-123!', { type: argon2id });

  // --- Users, profiles, credentials, KYC, wallets ---
  const userIds: string[] = [];
  for (const seed of userSeed) {
    const user = await prisma.user.upsert({
      where: { id: seed.id },
      update: { email: seed.email, phone: seed.phone, status: seed.status },
      create: {
        id: seed.id,
        email: seed.email,
        phone: seed.phone,
        status: seed.status,
        emailVerifiedAt: new Date('2026-01-05T00:00:00Z'),
        profile: { create: { firstName: seed.firstName, lastName: seed.lastName } },
        credential: { create: { passwordHash } },
      },
    });
    userIds.push(user.id);
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, firstName: seed.firstName, lastName: seed.lastName },
    });
    await prisma.kycProfile.upsert({
      where: { userId: user.id },
      update: { status: seed.kyc.status, tier: seed.kyc.tier, level: seed.kyc.level },
      create: {
        userId: user.id,
        status: seed.kyc.status,
        tier: seed.kyc.tier,
        level: seed.kyc.level,
        ...(seed.kyc.status === KycStatus.VERIFIED
          ? { verifiedAt: new Date('2026-01-10T00:00:00Z') }
          : {}),
        ...(seed.kyc.status === KycStatus.PENDING || seed.kyc.status === KycStatus.REQUIRES_REVIEW
          ? { submittedAt: new Date('2026-07-20T00:00:00Z') }
          : {}),
      },
    });
    await prisma.wallet.upsert({
      where: { userId_currency: { userId: user.id, currency: 'NGN' } },
      update: {},
      create: { userId: user.id, currency: 'NGN' },
    });
  }

  // KYC checks for the two verified-tier-2+ users to make the KYC page interesting
  const bisiKyc = await prisma.kycProfile.findUniqueOrThrow({
    where: { userId: '40000000-0000-4000-8000-000000000003' },
  });
  for (const [index, type] of [
    VerificationType.NIN,
    VerificationType.BANK_ACCOUNT,
    VerificationType.FACE_MATCH,
  ].entries()) {
    await prisma.kycCheck.upsert({
      where: {
        provider_providerRef: { provider: 'mock', providerRef: `dev:${bisiKyc.id}:${type}` },
      },
      update: {},
      create: {
        kycProfileId: bisiKyc.id,
        type,
        provider: 'mock',
        status: KycCheckStatus.PASSED,
        providerRef: `dev:${bisiKyc.id}:${type}`,
        maskedIdentifier: index === 0 ? '****1234' : index === 1 ? '0123456789' : null,
        checkedAt: new Date('2026-01-10T00:00:00Z'),
      },
    });
  }

  // --- Akawo goals ---
  for (const goal of goalSeed) {
    await prisma.savingsGoal.upsert({
      where: { id: goal.id },
      update: {
        name: goal.name,
        type: goal.type,
        targetMinor: goal.targetMinor,
        status: goal.status,
      },
      create: {
        id: goal.id,
        userId: goal.userId,
        name: goal.name,
        type: goal.type,
        targetMinor: goal.targetMinor,
        currency: 'NGN',
        status: goal.status,
      },
    });
  }

  // A pending auto-save schedule on the active target goal
  const schoolFees = await prisma.savingsGoal.findUniqueOrThrow({
    where: { id: '30000000-0000-4000-8000-000000000011' },
  });
  await prisma.savingsSchedule.upsert({
    where: { id: '30000000-0000-4000-8000-000000000021' },
    update: {},
    create: {
      id: '30000000-0000-4000-8000-000000000021',
      goalId: schoolFees.id,
      amountMinor: 40_000_00n,
      currency: 'NGN',
      dueAt: new Date('2026-08-20T09:00:00Z'),
      status: SavingsScheduleStatus.PENDING,
    },
  });

  // --- Food Ajo programmes ---
  for (const programme of programmeSeed) {
    await prisma.foodAjoGroup.upsert({
      where: { id: programme.id },
      update: {
        name: programme.name,
        status: programme.status,
        contributionMinor: programme.contributionMinor,
      },
      create: {
        id: programme.id,
        coordinatorUserId: programme.coordinatorUserId,
        name: programme.name,
        status: programme.status,
        contributionMinor: programme.contributionMinor,
        contributionFrequency: ContributionFrequency.MONTHLY,
        enrolmentCapacity: 40,
        fulfilmentMethod: FoodFulfilmentMethod.DELIVERY_OR_PICKUP,
        startsAt: new Date(programme.startsAt),
        endsAt: new Date(programme.endsAt),
      },
    });
    await prisma.foodPackage.upsert({
      where: { id: programme.package.id },
      update: { name: programme.package.name, priceMinor: programme.package.priceMinor },
      create: {
        id: programme.package.id,
        groupId: programme.id,
        name: programme.package.name,
        priceMinor: programme.package.priceMinor,
      },
    });
    for (const item of programme.items) {
      const existing = await prisma.foodPackageItem.findFirst({
        where: { packageId: programme.package.id, name: item.name },
      });
      if (!existing) {
        await prisma.foodPackageItem.create({
          data: {
            packageId: programme.package.id,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
          },
        });
      }
    }
  }

  // Active subscriptions on the open programme
  const openProgramme = await prisma.foodAjoGroup.findUniqueOrThrow({
    where: { id: '20000000-0000-4000-8000-000000000011' },
  });
  const openPackage = await prisma.foodPackage.findUniqueOrThrow({
    where: { id: '20000000-0000-4000-8000-000000000012' },
  });
  for (const subscriberId of [
    '40000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000006',
  ]) {
    await prisma.foodSubscription.upsert({
      where: {
        groupId_userId_packageId: {
          groupId: openProgramme.id,
          userId: subscriberId,
          packageId: openPackage.id,
        },
      },
      update: { status: FoodSubscriptionStatus.ACTIVE },
      create: {
        groupId: openProgramme.id,
        userId: subscriberId,
        packageId: openPackage.id,
        status: FoodSubscriptionStatus.ACTIVE,
      },
    });
  }

  // --- Ajo groups ---
  await seedAjoGroup(prisma, {
    id: '10000000-0000-4000-8000-000000000011',
    name: 'Sunshine Savings Circle',
    status: AjoGroupStatus.LOCKED,
    baseContributionMinor: 50_000_00n,
    members: [
      ['40000000-0000-4000-8000-000000000003', AjoMemberRole.MEMBER],
      ['40000000-0000-4000-8000-000000000004', AjoMemberRole.MEMBER],
      ['40000000-0000-4000-8000-000000000005', AjoMemberRole.GROUP_ADMIN],
    ],
  });
  await seedAjoGroup(prisma, {
    id: '10000000-0000-4000-8000-000000000012',
    name: 'Yaba Tech Collective',
    status: AjoGroupStatus.ACTIVE,
    baseContributionMinor: 25_000_00n,
    members: [
      ['40000000-0000-4000-8000-000000000009', AjoMemberRole.GROUP_ADMIN],
      ['40000000-0000-4000-8000-000000000003', AjoMemberRole.MEMBER],
      ['40000000-0000-4000-8000-000000000006', AjoMemberRole.MEMBER],
    ],
  });
  await seedAjoGroup(prisma, {
    id: '10000000-0000-4000-8000-000000000013',
    name: 'Neighbourhood Bazaar Ajo',
    status: AjoGroupStatus.OPEN,
    baseContributionMinor: 10_000_00n,
    members: [['40000000-0000-4000-8000-000000000004', AjoMemberRole.GROUP_ADMIN]],
  });

  // --- Coordinator applications ---
  const applications = [
    {
      id: '50000000-0000-4000-8000-000000000011',
      userId: '40000000-0000-4000-8000-000000000005',
      status: FoodCoordinatorApplicationStatus.APPROVED,
      approvedAt: new Date('2026-07-15T00:00:00Z'),
      expiresAt: new Date('2027-07-15T00:00:00Z'),
    },
    {
      id: '50000000-0000-4000-8000-000000000012',
      userId: '40000000-0000-4000-8000-000000000009',
      status: FoodCoordinatorApplicationStatus.MANUAL_REVIEW,
      approvedAt: null,
      expiresAt: null,
    },
    {
      id: '50000000-0000-4000-8000-000000000013',
      userId: '40000000-0000-4000-8000-000000000007',
      status: FoodCoordinatorApplicationStatus.REJECTED,
      approvedAt: null,
      expiresAt: null,
      rejectionReason: 'Business registration could not be verified at this time.',
    },
  ];
  for (const application of applications) {
    await prisma.foodCoordinatorApplication.upsert({
      where: { id: application.id },
      update: { status: application.status },
      create: {
        id: application.id,
        userId: application.userId,
        status: application.status,
        personalDetails: { businessContactName: 'Development Coordinator' },
        businessDetails: { tradingName: 'Development Trading Name' },
        operatingLocation: { state: 'Lagos', city: 'Ikeja' },
        fulfilmentLocations: [{ state: 'Lagos', city: 'Ikeja' }],
        submittedAt: new Date('2026-07-10T00:00:00Z'),
        ...(application.approvedAt ? { approvedAt: application.approvedAt } : {}),
        ...(application.expiresAt ? { expiresAt: application.expiresAt } : {}),
        ...(application.rejectionReason ? { rejectionReason: application.rejectionReason } : {}),
      },
    });
  }

  // --- Fee definitions ---
  await prisma.feeDefinition.upsert({
    where: { code_version: { code: 'PLATFORM_CONTRIBUTION_PERCENTAGE', version: 1 } },
    update: {},
    create: {
      code: 'PLATFORM_CONTRIBUTION_PERCENTAGE',
      version: 1,
      name: 'Development contribution percentage fee',
      calculationType: 'PERCENTAGE',
      basisPoints: 50,
      currency: 'NGN',
      minimumMinor: 100_00n,
      maximumMinor: 2_000_00n,
      payerType: 'MEMBER',
      chargeEvent: 'CONTRIBUTION_SETTLED',
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await prisma.feeDefinition.upsert({
    where: { code_version: { code: 'WITHDRAWAL_FIXED', version: 1 } },
    update: {},
    create: {
      code: 'WITHDRAWAL_FIXED',
      version: 1,
      name: 'Development withdrawal fee',
      calculationType: 'FIXED',
      amountMinor: 100_00n,
      currency: 'NGN',
      payerType: 'USER',
      chargeEvent: 'WITHDRAWAL_SUCCEEDED',
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
    },
  });

  // --- Bill Payment catalog + payments ---
  const category = await prisma.billCategory.upsert({
    where: { provider_providerCode: { provider: 'mock', providerCode: 'DEV_AIRTIME' } },
    update: {},
    create: {
      provider: 'mock',
      providerCode: 'DEV_AIRTIME',
      name: 'Airtime',
      refreshedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  });
  const biller = await prisma.billBiller.upsert({
    where: { categoryId_providerCode: { categoryId: category.id, providerCode: 'DEV_MTN' } },
    update: {},
    create: {
      categoryId: category.id,
      providerCode: 'DEV_MTN',
      name: 'MTN Airtime',
      refreshedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  });
  await prisma.billProduct.upsert({
    where: { billerId_providerCode: { billerId: biller.id, providerCode: 'DEV_MTN_500' } },
    update: {},
    create: {
      billerId: biller.id,
      providerCode: 'DEV_MTN_500',
      name: 'MTN ₦500 Airtime',
      fixedAmountMinor: 500_00n,
      currency: 'NGN',
      status: BillCatalogStatus.ACTIVE,
    },
  });

  const payingUserIds = [
    '40000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000009',
  ];
  for (const [index, payingUserId] of payingUserIds.entries()) {
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: payingUserId, currency: 'NGN' } },
    });
    await prisma.billPayment.upsert({
      where: { id: `60000000-0000-4000-8000-00000000000${index + 1}` },
      update: {},
      create: {
        id: `60000000-0000-4000-8000-00000000000${index + 1}`,
        internalReference: `DEV-BILL-${index + 1}`,
        provider: 'mock',
        providerReference: `dev-provider-${index + 1}`,
        idempotencyKey: `dev:bill:${index + 1}`,
        requestHash: `dev-request-hash-${index + 1}`,
        userId: payingUserId,
        walletId: wallet.id,
        billerId: biller.id,
        productId: (await prisma.billProduct.findFirstOrThrow({ where: { billerId: biller.id } }))
          .id,
        customerReferenceDigest: `dev-digest-${index + 1}`,
        customerReferenceMasked: '0803******12',
        verifiedCustomerName: 'Dev Customer',
        amountMinor: 500_00n,
        feeMinor: 0n,
        totalDebitMinor: 500_00n,
        currency: 'NGN',
        status: index === 2 ? BillPaymentStatus.PROCESSING : BillPaymentStatus.SUCCESSFUL,
        reconciliationState:
          index === 2 ? ReconciliationState.PENDING : ReconciliationState.NOT_REQUIRED,
        completedAt: index === 2 ? null : new Date(`2026-08-0${index + 1}T10:00:00Z`),
        processingAt: new Date(`2026-08-0${index + 1}T09:58:00Z`),
        validatedAt: new Date(`2026-08-0${index + 1}T09:57:00Z`),
      },
    });
  }

  // --- Ledger transactions for wallet activity ---
  const walletUsers = [
    [
      '40000000-0000-4000-8000-000000000003',
      150_000_00n,
      'WALLET-DEV-CREDIT-1',
      'dev:wallet-credit:1',
    ],
    [
      '40000000-0000-4000-8000-000000000004',
      200_000_00n,
      'WALLET-DEV-CREDIT-2',
      'dev:wallet-credit:2',
    ],
    [
      '40000000-0000-4000-8000-000000000009',
      300_000_00n,
      'WALLET-DEV-CREDIT-3',
      'dev:wallet-credit:3',
    ],
  ] as const;
  for (const [walletUserId, amount, reference, idempotencyKey] of walletUsers) {
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: walletUserId, currency: 'NGN' } },
    });
    const availableAccount = await prisma.financialAccount.upsert({
      where: { code: `WALLET:${wallet.id}:AVAILABLE` },
      update: {},
      create: {
        code: `WALLET:${wallet.id}:AVAILABLE`,
        name: 'Wallet available balance',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
        walletId: wallet.id,
        currency: 'NGN',
      },
    });
    const providerPayable = await prisma.financialAccount.findUniqueOrThrow({
      where: { code: 'PLATFORM:PROVIDER_PAYABLE:NGN' },
    });
    const existing = await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey } });
    if (!existing) {
      await prisma.ledgerTransaction.create({
        data: {
          reference,
          idempotencyKey,
          description: 'Development wallet funding',
          currency: 'NGN',
          status: LedgerTransactionStatus.POSTED,
          initiatedByUserId: walletUserId,
          postedAt: new Date('2026-07-20T00:00:00Z'),
          entries: {
            create: [
              {
                accountId: providerPayable.id,
                direction: LedgerEntryDirection.DEBIT,
                amountMinor: amount,
                currency: 'NGN',
                sequence: 1,
              },
              {
                accountId: availableAccount.id,
                direction: LedgerEntryDirection.CREDIT,
                amountMinor: amount,
                currency: 'NGN',
                sequence: 2,
              },
            ],
          },
        },
      });
    }
  }

  // --- Waitlist entries ---
  const waitlistSeed = [
    {
      id: '70000000-0000-4000-8000-000000000001',
      firstName: 'Ngozi',
      lastName: 'Eze',
      email: 'ngozi.eze@example.test',
      phone: '+2348011111111',
      wantsPromotions: true,
      createdAt: '2026-08-01T09:12:00Z',
    },
    {
      id: '70000000-0000-4000-8000-000000000002',
      firstName: 'Segun',
      lastName: 'Adeyemi',
      email: 'segun.adeyemi@example.test',
      phone: '+2348022222222',
      wantsPromotions: false,
      createdAt: '2026-08-02T14:40:00Z',
    },
    {
      id: '70000000-0000-4000-8000-000000000003',
      firstName: 'Chiamaka',
      lastName: 'Obi',
      email: 'chiamaka.obi@example.test',
      phone: '+2348033333333',
      wantsPromotions: true,
      createdAt: '2026-08-03T11:05:00Z',
    },
    {
      id: '70000000-0000-4000-8000-000000000004',
      firstName: 'Ibrahim',
      lastName: 'Yusuf',
      email: 'ibrahim.yusuf@example.test',
      phone: '+2348044444444',
      wantsPromotions: true,
      createdAt: '2026-08-05T16:22:00Z',
    },
    {
      id: '70000000-0000-4000-8000-000000000005',
      firstName: 'Funke',
      lastName: 'Alabi',
      email: 'funke.alabi@example.test',
      phone: '+2348055555555',
      wantsPromotions: false,
      createdAt: '2026-08-06T08:45:00Z',
    },
  ];
  for (const entry of waitlistSeed) {
    await prisma.waitlistEntry.upsert({
      where: { id: entry.id },
      update: { status: 'ACTIVE' },
      create: {
        id: entry.id,
        firstName: entry.firstName,
        lastName: entry.lastName,
        email: entry.email,
        phone: entry.phone,
        wantsPromotions: entry.wantsPromotions,
        status: 'ACTIVE',
        createdAt: new Date(entry.createdAt),
      },
    });
  }

  // --- Support inquiries ---
  const inquirySeed = [
    {
      id: '80000000-0000-4000-8000-000000000001',
      name: 'Ngozi Eze',
      email: 'ngozi.eze@example.test',
      phone: '+2348011111111',
      subject: 'How do I create a second Ajo group?',
      message:
        'I already run one group with my colleagues and want to start a second one for my church. Can I run both at the same time on my account?',
      status: 'OPEN',
      createdAt: '2026-08-04T10:18:00Z',
    },
    {
      id: '80000000-0000-4000-8000-000000000002',
      name: 'Segun Adeyemi',
      email: 'segun.adeyemi@example.test',
      phone: '+2348022222222',
      subject: 'Problem with Food Ajo delivery slot',
      message:
        'My programme said delivery happens on the first Saturday, but I did not receive my basket and no one from support responded in the group chat.',
      status: 'OPEN',
      createdAt: '2026-08-05T13:30:00Z',
    },
    {
      id: '80000000-0000-4000-8000-000000000003',
      name: 'Chiamaka Obi',
      email: 'chiamaka.obi@example.test',
      phone: '+2348033333333',
      subject: 'Suggesting a flexible contribution option',
      message:
        'Some members in my circle want to contribute different amounts each cycle. Would you consider a flexible contribution mode for Ajo groups?',
      status: 'RESOLVED',
      createdAt: '2026-08-02T09:00:00Z',
    },
    {
      id: '80000000-0000-4000-8000-000000000004',
      name: 'Ibrahim Yusuf',
      email: 'ibrahim.yusuf@example.test',
      phone: '+2348044444444',
      subject: 'Receipt for bill payment not showing',
      message:
        'I paid for airtime yesterday and the money left my wallet, but I cannot see the receipt in my transaction history. Please check my account.',
      status: 'OPEN',
      createdAt: '2026-08-06T17:05:00Z',
    },
  ];
  for (const inquiry of inquirySeed) {
    await prisma.supportInquiry.upsert({
      where: { id: inquiry.id },
      update: { status: inquiry.status },
      create: {
        id: inquiry.id,
        name: inquiry.name,
        email: inquiry.email,
        phone: inquiry.phone,
        subject: inquiry.subject,
        message: inquiry.message,
        status: inquiry.status,
        createdAt: new Date(inquiry.createdAt),
      },
    });
  }

  // Ensure a LOCKED group has a schedule version + a couple of cycles so the group page is rich
  const lockedGroup = await prisma.ajoGroup.findUniqueOrThrow({
    where: { id: '10000000-0000-4000-8000-000000000011' },
  });
  if (lockedGroup.scheduleVersion === 0) {
    await prisma.ajoGroup.update({
      where: { id: lockedGroup.id },
      data: { scheduleVersion: 1, lockedAt: new Date('2026-07-25T00:00:00Z') },
    });
    const cycleBase = new Date('2026-08-01T00:00:00Z');
    for (const cycle of [1, 2, 3]) {
      const dueDate = new Date(cycleBase.getTime() + (cycle - 1) * 28 * 24 * 60 * 60 * 1000);
      await prisma.ajoCycle.upsert({
        where: { groupId_sequence: { groupId: lockedGroup.id, sequence: cycle } },
        update: {},
        create: {
          groupId: lockedGroup.id,
          sequence: cycle,
          status:
            cycle === 1
              ? AjoCycleStatus.COMPLETED
              : cycle === 2
                ? AjoCycleStatus.OPEN
                : AjoCycleStatus.PENDING,
          contributionDueAt: dueDate,
          contributionOpensAt: new Date(dueDate.getTime() - 24 * 60 * 60 * 1000),
          contributionClosesAt: new Date(dueDate.getTime() + 48 * 60 * 60 * 1000),
          graceEndsAt: new Date(dueDate.getTime() + 72 * 60 * 60 * 1000),
          payoutEligibilityCutoffAt: new Date(dueDate.getTime() + 72 * 60 * 60 * 1000),
          payoutDueAt: new Date(dueDate.getTime() + 96 * 60 * 60 * 1000),
          payoutProcessingEndsAt: new Date(dueDate.getTime() + 120 * 60 * 60 * 1000),
        },
      });
    }
  }
}

async function seedAjoGroup(
  prisma: PrismaClient,
  input: {
    id: string;
    name: string;
    status: AjoGroupStatus;
    baseContributionMinor: bigint;
    members: ReadonlyArray<[string, AjoMemberRole]>;
  },
): Promise<void> {
  await prisma.ajoGroup.upsert({
    where: { id: input.id },
    update: { name: input.name, status: input.status },
    create: {
      id: input.id,
      name: input.name,
      status: input.status,
      contributionMode: AjoContributionMode.FIXED,
      contributionFrequency: ContributionFrequency.MONTHLY,
      baseContributionMinor: input.baseContributionMinor,
      currency: 'NGN',
      maxMembers: Math.max(2, input.members.length),
      maxSlots: Math.max(2, input.members.length),
      maxSlotsPerMember: 1,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-11-30'),
      createdByUserId: input.members[0]![0],
      ...(input.status === AjoGroupStatus.LOCKED || input.status === AjoGroupStatus.ACTIVE
        ? {
            lockedAt: new Date('2026-07-25T00:00:00Z'),
            activatedAt: new Date('2026-08-01T00:00:00Z'),
          }
        : {}),
    },
  });
  const slots = await prisma.ajoSlot.count({ where: { groupId: input.id } });
  for (const [index, [userId, role]] of input.members.entries()) {
    const member = await prisma.ajoGroupMember.upsert({
      where: { groupId_userId: { groupId: input.id, userId } },
      update: { role, status: AjoMemberStatus.ACTIVE, joinedAt: new Date('2026-07-20T00:00:00Z') },
      create: {
        groupId: input.id,
        userId,
        role,
        status: AjoMemberStatus.ACTIVE,
        joinedAt: new Date('2026-07-20T00:00:00Z'),
      },
    });
    if (slots === 0) {
      await prisma.ajoSlot.create({
        data: {
          groupId: input.id,
          memberId: member.id,
          position: index + 1,
          status: AjoSlotStatus.ACTIVE,
        },
      });
    }
  }
}
