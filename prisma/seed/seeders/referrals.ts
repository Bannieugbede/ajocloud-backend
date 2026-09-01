import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  KycTier,
  ReferralCampaignStatus,
  ReferralRewardStatus,
  ReferralStatus,
} from '../../../generated/prisma/enums.js';

/**
 * Referral campaign, referrals, qualifications, and rewards.
 *
 * The campaign is effective-dated configuration rather than a hard-coded rule.
 * The brief's "Ajo or Food Ajo #5" wording is still unresolved — see
 * `docs/open-questions/referral-qualification-rule.md` — so this seeds a
 * plausible, clearly-fake configuration to exercise the model, and must not be
 * read as an approved business rule.
 */

const CAMPAIGN_ID = '60000000-0000-4000-8000-000000000001';

export async function seedReferrals(prisma: PrismaClient): Promise<void> {
  const [referrer, qualified, pending] = await Promise.all([
    prisma.user.findUnique({ where: { email: 'ada.admin@example.test' } }),
    prisma.user.findUnique({ where: { email: 'bisi.adeyemi@example.test' } }),
    prisma.user.findUnique({ where: { email: 'chidi.nwosu@example.test' } }),
  ]);
  if (!referrer || !qualified || !pending) return;

  const campaign = await prisma.referralCampaign.upsert({
    where: { code_version: { code: 'LAUNCH_REFERRAL', version: 1 } },
    update: { status: ReferralCampaignStatus.ACTIVE },
    create: {
      id: CAMPAIGN_ID,
      code: 'LAUNCH_REFERRAL',
      version: 1,
      status: ReferralCampaignStatus.ACTIVE,
      qualifyingProduct: 'AJO',
      qualifyingEvent: 'CONTRIBUTION_SETTLED',
      minimumTransactionCount: 1,
      minimumAmountMinor: 1_000_00n,
      requiredKycTier: KycTier.TIER_2,
      rewardAmountMinor: 500_00n,
      rewardCurrency: 'NGN',
      maximumRewards: 1,
      // Controls the model supports; the real values are a product decision.
      fraudRestrictions: {
        oneRewardPerDevice: true,
        oneRewardPerBankAccount: true,
        blockCircularReferrals: true,
      },
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
    },
  });

  // A referral that settled and paid out, so the rewarded path is visible.
  const rewarded = await prisma.referral.upsert({
    where: { referredUserId: qualified.id },
    update: {},
    create: {
      referrerUserId: referrer.id,
      referredUserId: qualified.id,
      campaignId: campaign.id,
      code: 'ADA-LAUNCH-01',
      status: ReferralStatus.REWARDED,
      qualifiedAt: new Date('2026-07-20T12:00:00Z'),
    },
  });

  const existingQualification = await prisma.referralQualification.findFirst({
    where: { referralId: rewarded.id },
  });
  if (!existingQualification) {
    await prisma.referralQualification.create({
      data: {
        referralId: rewarded.id,
        // A settled contribution is the qualifying event; a placeholder id is
        // used because the contribution workflow is not built yet.
        qualifyingEventId: '60000000-0000-4000-8000-000000000010',
        qualifyingProduct: 'AJO',
        qualifyingEvent: 'CONTRIBUTION_SETTLED',
        settledAmountMinor: 25_000_00n,
        currency: 'NGN',
        occurredAt: new Date('2026-07-20T12:00:00Z'),
      },
    });
  }

  await prisma.referralReward.upsert({
    where: { idempotencyKey: 'seed:referral-reward:bisi' },
    update: {},
    create: {
      referralId: rewarded.id,
      amountMinor: 500_00n,
      currency: 'NGN',
      status: ReferralRewardStatus.RELEASED,
      idempotencyKey: 'seed:referral-reward:bisi',
      awardedAt: new Date('2026-07-20T12:05:00Z'),
    },
  });

  // A referral still awaiting its qualifying event, so the pending path exists.
  await prisma.referral.upsert({
    where: { referredUserId: pending.id },
    update: {},
    create: {
      referrerUserId: referrer.id,
      referredUserId: pending.id,
      campaignId: campaign.id,
      code: 'ADA-LAUNCH-02',
      status: ReferralStatus.PENDING,
    },
  });
}
