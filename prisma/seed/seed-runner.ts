import { PrismaPg } from '@prisma/adapter-pg';
import { hash, argon2id } from 'argon2';
import { PrismaClient } from '../../generated/prisma/client.js';
import {
  AjoGroupStatus,
  AjoMemberRole,
  AjoMemberStatus,
  AjoSlotStatus,
  ContributionFrequency,
  AccountType,
  FinancialAccountPurpose,
  UserStatus,
} from '../../generated/prisma/enums.js';

const PERMISSIONS = [
  'users.read',
  'users.suspend',
  'kyc.review',
  'food-coordinators.review',
  'bill-payments.reconcile',
  'ajo.create',
  'ajo.manage',
  'ajo.lock',
  'ajo.swap.initiate',
  'ajo.swap.approve',
  'payouts.review',
  'payouts.execute',
  'withdrawals.review',
  'fees.manage',
  'disputes.manage',
  'audit.read',
] as const;

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  SUPER_ADMIN: PERMISSIONS,
  PLATFORM_ADMIN: PERMISSIONS,
  COMPLIANCE_OFFICER: ['users.read', 'kyc.review', 'food-coordinators.review', 'audit.read'],
  FINANCE_OFFICER: [
    'users.read',
    'payouts.review',
    'payouts.execute',
    'withdrawals.review',
    'audit.read',
  ],
  SUPPORT_OFFICER: ['users.read', 'disputes.manage'],
  GROUP_ADMIN: ['ajo.create', 'ajo.manage', 'ajo.lock', 'ajo.swap.initiate', 'ajo.swap.approve'],
  FOOD_COORDINATOR: ['ajo.create'],
  MEMBER: ['ajo.create', 'ajo.lock', 'ajo.swap.initiate'],
};

export async function runSeed(): Promise<void> {
  const environment = process.env.NODE_ENV ?? 'development';
  if (environment === 'production' || process.env.ALLOW_SEED !== 'true') {
    throw new Error('Seeding is disabled. Set ALLOW_SEED=true in a non-production environment.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for seeding');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const permissions = new Map<string, string>();
    for (const key of PERMISSIONS) {
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      });
      permissions.set(key, permission.id);
    }
    const roles = new Map<string, string>();
    for (const [name, keys] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await prisma.role.upsert({
        where: { name },
        update: {},
        create: { name, isSystem: true },
      });
      roles.set(name, role.id);
      await prisma.rolePermission.createMany({
        data: keys.map((key) => ({ roleId: role.id, permissionId: required(permissions, key) })),
        skipDuplicates: true,
      });
    }

    const passwordHash = await hash('Development-Only-Password-123!', { type: argon2id });
    const admin = await prisma.user.upsert({
      where: { email: 'ada.admin@example.test' },
      update: {},
      create: {
        email: 'ada.admin@example.test',
        status: UserStatus.ACTIVE,
        profile: { create: { firstName: 'Ada', lastName: 'Testadmin' } },
        credential: { create: { passwordHash } },
        wallets: { create: { currency: 'NGN' } },
      },
    });
    for (const roleName of ['PLATFORM_ADMIN', 'MEMBER']) {
      const roleId = required(roles, roleName);
      const assignment = await prisma.userRole.findFirst({
        where: { userId: admin.id, roleId, organisationId: null, groupId: null },
      });
      if (!assignment) await prisma.userRole.create({ data: { userId: admin.id, roleId } });
    }

    await prisma.feeDefinition.upsert({
      where: { code_version: { code: 'PLATFORM_CONTRIBUTION_FIXED', version: 1 } },
      update: {},
      create: {
        code: 'PLATFORM_CONTRIBUTION_FIXED',
        version: 1,
        name: 'Development platform contribution fee',
        calculationType: 'FIXED',
        amountMinor: 0n,
        currency: 'NGN',
        payerType: 'MEMBER',
        chargeEvent: 'CONTRIBUTION_SETTLED',
        effectiveAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.feeDefinition.upsert({
      where: { code_version: { code: 'BILL_PAYMENT', version: 1 } },
      update: {},
      create: {
        code: 'BILL_PAYMENT',
        version: 1,
        name: 'Development Bill Payment fee',
        calculationType: 'FIXED',
        amountMinor: 0n,
        currency: 'NGN',
        payerType: 'USER',
        chargeEvent: 'BILL_PAYMENT_CREATED',
        effectiveAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const adminWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: admin.id, currency: 'NGN' } },
    });
    for (const account of [
      {
        code: `WALLET:${adminWallet.id}:AVAILABLE`,
        name: 'Wallet available balance',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
        walletId: adminWallet.id,
      },
      {
        code: `WALLET:${adminWallet.id}:RESERVED`,
        name: 'Wallet reserved balance',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.WALLET_RESERVED,
        walletId: adminWallet.id,
      },
      {
        code: 'PLATFORM:PROVIDER_PAYABLE:NGN',
        name: 'Provider payable',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.PROVIDER_PAYABLE,
      },
      {
        code: 'PLATFORM:FEE_REVENUE:NGN',
        name: 'Platform fee revenue',
        type: AccountType.REVENUE,
        purpose: FinancialAccountPurpose.PLATFORM_FEE_REVENUE,
      },
    ] as const) {
      await prisma.financialAccount.upsert({
        where: { code: account.code },
        update: {},
        create: { ...account, currency: 'NGN' },
      });
    }

    await prisma.publicAppConfiguration.upsert({
      where: { key_version: { key: 'brand', version: 1 } },
      update: {},
      create: {
        key: 'brand',
        version: 1,
        effectiveAt: new Date('2026-01-01T00:00:00Z'),
        value: {
          name: 'Ajo Cloud',
          colors: {
            primary: '#0D47A1',
            teal: '#15B0BB',
            skyBlue: '#4DD0E1',
            lightBlue: '#E3F6FA',
            darkGray: '#212B36',
            gray: '#637280',
          },
        },
      },
    });

    const group = await prisma.ajoGroup.upsert({
      where: { id: '10000000-0000-4000-8000-000000000001' },
      update: {},
      create: {
        id: '10000000-0000-4000-8000-000000000001',
        name: 'Lagos Market Friends Test Ajo',
        status: AjoGroupStatus.DRAFT,
        contributionFrequency: ContributionFrequency.MONTHLY,
        baseContributionMinor: 25_000_00n,
        currency: 'NGN',
        maxSlots: 6,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-01-01'),
        createdByUserId: admin.id,
      },
    });
    const member = await prisma.ajoGroupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: admin.id } },
      update: {},
      create: {
        groupId: group.id,
        userId: admin.id,
        role: AjoMemberRole.GROUP_ADMIN,
        status: AjoMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    });
    await prisma.ajoSlot.createMany({
      data: [1, 2].map((position) => ({
        groupId: group.id,
        memberId: member.id,
        position,
        status: AjoSlotStatus.RESERVED,
      })),
      skipDuplicates: true,
    });

    const foodGroup = await prisma.foodAjoGroup.upsert({
      where: { id: '20000000-0000-4000-8000-000000000001' },
      update: {},
      create: {
        id: '20000000-0000-4000-8000-000000000001',
        coordinatorUserId: admin.id,
        name: 'Fake Family Rice Plan',
        contributionMinor: 10_000_00n,
        startsAt: new Date('2026-08-01'),
        endsAt: new Date('2026-12-01'),
      },
    });
    await prisma.foodPackage.upsert({
      where: { id: '20000000-0000-4000-8000-000000000002' },
      update: {},
      create: {
        id: '20000000-0000-4000-8000-000000000002',
        groupId: foodGroup.id,
        name: 'Test Staple Package',
        priceMinor: 50_000_00n,
      },
    });
    await prisma.savingsGoal.upsert({
      where: { id: '30000000-0000-4000-8000-000000000001' },
      update: {},
      create: {
        id: '30000000-0000-4000-8000-000000000001',
        userId: admin.id,
        name: 'Fake Rent Goal',
        targetMinor: 600_000_00n,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing seeded value: ${key}`);
  return value;
}
