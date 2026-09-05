import { argon2id, hash } from 'argon2';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  AccountType,
  FinancialAccountPurpose,
  KycCheckStatus,
  KycStatus,
  KycTier,
  UserStatus,
  VerificationType,
} from '../../../generated/prisma/enums.js';

/**
 * The cast every product screen draws from.
 *
 * One place, because the same people appear as an Ajo admin here, a pool
 * organiser there, and a food coordinator elsewhere. Seeding them per-product
 * would create near-duplicates and make the demo read as a set of unrelated
 * fixtures rather than one community.
 *
 * Every address is `@example.test`, a reserved domain that cannot receive mail,
 * and every phone number is in Nigeria's reserved test range. Nothing here is
 * a real identity, and the password is shared and obviously non-production.
 */

export const DEMO_PASSWORD = 'Development-Only-Password-123!';

export type DemoMember = {
  readonly key: string;
  readonly email: string;
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly referralCode: string;
  readonly tier: KycTier;
  /** Whether identity checks have passed, which gates the verified badge. */
  readonly verified: boolean;
};

export const DEMO_MEMBERS: readonly DemoMember[] = [
  {
    key: 'chisom',
    email: 'chisom.okafor@example.test',
    phone: '+2348012345678',
    firstName: 'Chisom',
    lastName: 'Okafor',
    referralCode: 'AJO-CH2SOM',
    tier: KycTier.TIER_3,
    verified: true,
  },
  {
    key: 'adebayo',
    email: 'adebayo.okonkwo@example.test',
    phone: '+2348012345679',
    firstName: 'Adebayo',
    lastName: 'Okonkwo',
    referralCode: 'AJO-ADEB2Y',
    tier: KycTier.TIER_2,
    verified: true,
  },
  {
    key: 'emeka',
    email: 'emeka.nwosu@example.test',
    phone: '+2348012345680',
    firstName: 'Emeka',
    lastName: 'Nwosu',
    referralCode: 'AJO-EMEK2N',
    tier: KycTier.TIER_2,
    verified: true,
  },
  {
    key: 'amaka',
    email: 'amaka.obiora@example.test',
    phone: '+2348012345681',
    firstName: 'Amaka',
    lastName: 'Obiora',
    referralCode: 'AJO-AMAK2O',
    tier: KycTier.TIER_2,
    verified: true,
  },
  {
    key: 'emekaj',
    email: 'emeka.johnson@example.test',
    phone: '+2348012345682',
    firstName: 'Emeka',
    lastName: 'Johnson',
    referralCode: 'AJO-EMEK2J',
    tier: KycTier.TIER_2,
    verified: true,
  },
  {
    key: 'bode',
    email: 'bode.adewale@example.test',
    phone: '+2348012345683',
    firstName: 'Bode',
    lastName: 'Adewale',
    referralCode: 'AJO-BODE2W',
    tier: KycTier.TIER_2,
    verified: true,
  },
  {
    key: 'ngozi',
    email: 'ngozi.eze@example.test',
    phone: '+2348012345684',
    firstName: 'Ngozi',
    lastName: 'Eze',
    referralCode: 'AJO-NGOZ2E',
    tier: KycTier.TIER_3,
    verified: true,
  },
  {
    key: 'ade',
    email: 'ade.williams@example.test',
    phone: '+2348012345685',
    firstName: 'Ade',
    lastName: 'Williams',
    referralCode: 'AJO-ADEW2L',
    tier: KycTier.TIER_3,
    verified: true,
  },
  {
    key: 'tunde',
    email: 'tunde.bakare@example.test',
    phone: '+2348012345686',
    firstName: 'Tunde',
    lastName: 'Bakare',
    referralCode: 'AJO-TUND2B',
    tier: KycTier.TIER_1,
    // Deliberately unverified, so every screen has a case where the badge is
    // absent and verification is still outstanding.
    verified: false,
  },
  {
    key: 'fatima',
    email: 'fatima.yusuf@example.test',
    phone: '+2348012345687',
    firstName: 'Fatima',
    lastName: 'Yusuf',
    referralCode: 'AJO-FATI2Y',
    tier: KycTier.TIER_2,
    verified: true,
  },
];

/** Seeded users by their key, for the product seeders that follow. */
export type DemoUsers = ReadonlyMap<string, string>;

export async function seedDemoMembers(prisma: PrismaClient): Promise<DemoUsers> {
  const passwordHash = await hash(DEMO_PASSWORD, { type: argon2id });
  const memberRole = await prisma.role.upsert({
    where: { name: 'MEMBER' },
    update: {},
    create: { name: 'MEMBER', isSystem: true },
  });

  const users = new Map<string, string>();

  for (const member of DEMO_MEMBERS) {
    const user = await prisma.user.upsert({
      where: { email: member.email },
      update: {
        phone: member.phone,
        referralCode: member.referralCode,
        status: UserStatus.ACTIVE,
      },
      create: {
        email: member.email,
        phone: member.phone,
        referralCode: member.referralCode,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        profile: { create: { firstName: member.firstName, lastName: member.lastName } },
        credential: { create: { passwordHash } },
        wallets: { create: { currency: 'NGN' } },
        roleAssignments: { create: { roleId: memberRole.id } },
      },
    });
    users.set(member.key, user.id);

    // A wallet without its ledger accounts cannot hold a balance, so these are
    // created alongside rather than left to the first payment.
    const wallet = await prisma.wallet.findUnique({
      where: { userId_currency: { userId: user.id, currency: 'NGN' } },
      select: { id: true },
    });
    if (wallet) {
      await prisma.financialAccount.createMany({
        data: [
          {
            code: `WALLET:${wallet.id}:AVAILABLE`,
            name: 'Wallet available balance',
            type: AccountType.LIABILITY,
            purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
            currency: 'NGN',
            walletId: wallet.id,
          },
          {
            code: `WALLET:${wallet.id}:RESERVED`,
            name: 'Wallet reserved balance',
            type: AccountType.LIABILITY,
            purpose: FinancialAccountPurpose.WALLET_RESERVED,
            currency: 'NGN',
            walletId: wallet.id,
          },
        ],
        skipDuplicates: true,
      });
    }

    const kyc = await prisma.kycProfile.upsert({
      where: { userId: user.id },
      update: { tier: member.tier },
      create: {
        userId: user.id,
        tier: member.tier,
        status: member.verified ? KycStatus.VERIFIED : KycStatus.NOT_STARTED,
        level: member.verified ? 3 : 1,
        ...(member.verified ? { verifiedAt: new Date('2026-02-01T00:00:00Z') } : {}),
      },
    });

    if (member.verified) {
      const existing = await prisma.kycCheck.findFirst({
        where: { kycProfileId: kyc.id, type: VerificationType.BVN },
        select: { id: true },
      });
      if (!existing) {
        await prisma.kycCheck.create({
          data: {
            kycProfileId: kyc.id,
            type: VerificationType.BVN,
            provider: 'seed',
            status: KycCheckStatus.PASSED,
            // Only the masked value is ever persisted (ADR-004). These digits
            // are fabricated and belong to no real person.
            maskedIdentifier: `*******${member.phone.slice(-4)}`,
            checkedAt: new Date('2026-02-01T00:00:00Z'),
          },
        });
      }
    }
  }

  return users;
}

/** Reads a seeded user id, failing loudly rather than silently skipping. */
export function demoUser(users: DemoUsers, key: string): string {
  const id = users.get(key);
  if (!id) throw new Error(`Demo member "${key}" was not seeded`);
  return id;
}
