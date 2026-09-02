import { hash, argon2id } from 'argon2';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  ComplianceReviewStatus,
  ConsentType,
  FoodCoordinatorApplicationStatus,
} from '../../../generated/prisma/enums.js';
import { accountNumberDigest } from '../../../src/modules/kyc/domain/identity-verification-policy.js';

/**
 * Identity and compliance evidence: recorded consents, a linked bank account, a
 * transaction PIN, open and decided compliance reviews, coordinator review
 * history, and audit entries.
 *
 * Every value here is clearly fake. The bank account is stored the way the
 * application stores one — masked plus an HMAC digest — so no seeded row ever
 * contains a recoverable account number.
 */

/** The PIN and account number are development-only and deliberately obvious. */
// Must be TRANSACTION_PIN_LENGTH digits: the PIN DTOs reject anything else
// before it is ever hashed, so a longer seed PIN can never be verified through
// the API and makes every seeded payment flow untestable.
const SEED_PIN = '1357';
const SEED_ACCOUNT_NUMBER = '0000000001';

export async function seedIdentityAndCompliance(prisma: PrismaClient): Promise<void> {
  const tokenPepper = process.env.TOKEN_PEPPER;
  if (!tokenPepper) throw new Error('TOKEN_PEPPER is required for identity seed data');

  const admin = await prisma.user.findUnique({ where: { email: 'ada.admin@example.test' } });
  if (!admin) return;

  // Consent is versioned; recording it lets the registration flow's consent
  // checks pass against a seeded account.
  for (const [type, version] of [
    [ConsentType.PRIVACY, '2026-01-01'],
    [ConsentType.IDENTITY_VERIFICATION, '2026-08-19'],
  ] as const) {
    await prisma.userConsent.upsert({
      where: { userId_type_version: { userId: admin.id, type, version } },
      update: {},
      create: { userId: admin.id, type, version, acceptedAt: new Date('2026-01-01T00:00:00Z') },
    });
  }

  const existingBank = await prisma.linkedBankAccount.findFirst({ where: { userId: admin.id } });
  if (!existingBank) {
    await prisma.linkedBankAccount.create({
      data: {
        userId: admin.id,
        bankCode: '999999',
        bankName: 'Development Test Bank',
        accountMasked: '******0001',
        accountDigest: accountNumberDigest(SEED_ACCOUNT_NUMBER, tokenPepper),
        accountName: 'Ada Testadmin',
        provider: 'mock',
        providerRef: 'seed-account-inquiry',
        verifiedAt: new Date('2026-01-02T00:00:00Z'),
      },
    });
  }

  // Hashed exactly as the application hashes it, so the seeded PIN verifies.
  await prisma.transactionPin.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      userId: admin.id,
      pinHash: await hash(SEED_PIN, { type: argon2id }),
      changedAt: new Date('2026-01-02T00:00:00Z'),
    },
  });

  // One open review so the compliance queue has an item to decide, and one
  // decided review so the history panel is not empty.
  const pendingKyc = await prisma.kycProfile.findFirst({
    where: { status: { in: ['PENDING', 'REQUIRES_REVIEW'] } },
    orderBy: { createdAt: 'asc' },
  });
  if (pendingKyc) {
    const open = await prisma.complianceReview.findFirst({
      where: { kycProfileId: pendingKyc.id, status: ComplianceReviewStatus.OPEN },
    });
    if (!open) {
      await prisma.complianceReview.create({
        data: {
          kycProfileId: pendingKyc.id,
          status: ComplianceReviewStatus.OPEN,
          reason: 'Automated checks returned a partial name match.',
        },
      });
    }
  }

  const verifiedKyc = await prisma.kycProfile.findFirst({
    where: { userId: admin.id },
  });
  if (verifiedKyc) {
    const decided = await prisma.complianceReview.findFirst({
      where: { kycProfileId: verifiedKyc.id, status: ComplianceReviewStatus.APPROVED },
    });
    if (!decided) {
      await prisma.complianceReview.create({
        data: {
          kycProfileId: verifiedKyc.id,
          reviewerId: admin.id,
          status: ComplianceReviewStatus.APPROVED,
          reason: 'Identity and bank evidence verified.',
          decidedAt: new Date('2026-01-02T00:00:00Z'),
        },
      });
    }
  }

  const application = await prisma.foodCoordinatorApplication.findFirst({
    where: { status: FoodCoordinatorApplicationStatus.APPROVED },
    orderBy: { createdAt: 'asc' },
  });
  if (application) {
    const existingReview = await prisma.foodCoordinatorReview.findFirst({
      where: { applicationId: application.id },
    });
    if (!existingReview) {
      await prisma.foodCoordinatorReview.create({
        data: {
          applicationId: application.id,
          reviewerUserId: admin.id,
          fromStatus: FoodCoordinatorApplicationStatus.MANUAL_REVIEW,
          toStatus: FoodCoordinatorApplicationStatus.APPROVED,
          notes: 'Business registration and settlement account both verified.',
        },
      });
    }
  }

  // A short audit trail so the audit surface is not empty. These mirror actions
  // the application itself writes.
  const auditEntries = [
    {
      action: 'kyc.profile.approve',
      subjectType: 'KycProfile',
      subjectId: verifiedKyc?.id,
      metadata: { fromStatus: 'PENDING', toStatus: 'VERIFIED', tier: 'TIER_3' },
    },
    {
      action: 'food.coordinator.application.approved',
      subjectType: 'FoodCoordinatorApplication',
      subjectId: application?.id,
      metadata: { toStatus: 'APPROVED' },
    },
  ] as const;

  for (const entry of auditEntries) {
    if (!entry.subjectId) continue;
    const existing = await prisma.auditLog.findFirst({
      where: { action: entry.action, subjectId: entry.subjectId },
    });
    if (!existing) {
      await prisma.auditLog.create({
        data: {
          actorUserId: admin.id,
          action: entry.action,
          subjectType: entry.subjectType,
          subjectId: entry.subjectId,
          metadata: entry.metadata,
        },
      });
    }
  }
}
