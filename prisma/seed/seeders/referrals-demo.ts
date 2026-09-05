import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  AccountType,
  FinancialAccountPurpose,
  KycTier,
  ReferralCampaignStatus,
  ReferralRewardStatus,
  ReferralStatus,
} from '../../../generated/prisma/enums.js';
import { DEMO_MEMBERS, demoUser, type DemoUsers } from './demo-members.js';

/**
 * Referrals made by the demo account, and the rewards they earned.
 *
 * The Profile card reads its invite count and earned total from these rows,
 * and both must agree with the ledger — a rewards figure with no posting behind
 * it would be a number the balance sheet cannot support. So each released
 * reward here is posted as a real transaction, exactly as the engine would.
 * See ADR-012.
 */

const CAMPAIGN_ID = '60000000-0000-4000-8000-000000000101';
const REWARD_MINOR = 1_000_00n;

/**
 * Who Chisom referred, and how far each got. Six rewarded referrals at ₦1,000
 * is the ₦6,000 the Profile card shows; the rest are invites that have not
 * qualified, which is the ordinary case and should not be hidden.
 */
const REFERRALS: readonly { key: string; status: ReferralStatus }[] = [
  { key: 'adebayo', status: ReferralStatus.REWARDED },
  { key: 'emeka', status: ReferralStatus.REWARDED },
  { key: 'amaka', status: ReferralStatus.REWARDED },
  { key: 'emekaj', status: ReferralStatus.REWARDED },
  { key: 'bode', status: ReferralStatus.REWARDED },
  { key: 'ngozi', status: ReferralStatus.REWARDED },
  // Signed up but has not deposited yet.
  { key: 'ade', status: ReferralStatus.PENDING },
  // Signed up and never verified, so this one will not qualify.
  { key: 'tunde', status: ReferralStatus.PENDING },
  { key: 'fatima', status: ReferralStatus.PENDING },
];

export async function seedReferralsDemo(prisma: PrismaClient, users: DemoUsers): Promise<void> {
  const referrerId = demoUser(users, 'chisom');
  const referrerCode =
    DEMO_MEMBERS.find((member) => member.key === 'chisom')?.referralCode ?? 'AJO-CH2SOM';

  const campaign = await prisma.referralCampaign.upsert({
    where: { code_version: { code: 'DEMO_LAUNCH', version: 1 } },
    update: { status: ReferralCampaignStatus.ACTIVE },
    create: {
      id: CAMPAIGN_ID,
      code: 'DEMO_LAUNCH',
      version: 1,
      status: ReferralCampaignStatus.ACTIVE,
      qualifyingProduct: 'WALLET',
      qualifyingEvent: 'deposit.settled',
      minimumTransactionCount: 1,
      requiredKycTier: KycTier.TIER_1,
      rewardAmountMinor: REWARD_MINOR,
      rewardCurrency: 'NGN',
      maximumRewards: 20,
      fraudRestrictions: {
        blockSelfReferral: true,
        blockDuplicateIdentity: true,
        oneRewardPerReferral: true,
        reverseOnDepositReversal: true,
      },
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
    },
  });

  // The expense account the rewards are paid from. Created here rather than
  // assumed, for the same reason the service creates it on first use.
  const expense = await prisma.financialAccount.upsert({
    where: { code: 'PLATFORM:REFERRAL_REWARD_EXPENSE:NGN' },
    update: {},
    create: {
      code: 'PLATFORM:REFERRAL_REWARD_EXPENSE:NGN',
      name: 'Referral reward expense',
      type: AccountType.EXPENSE,
      purpose: FinancialAccountPurpose.REFERRAL_REWARD_EXPENSE,
      currency: 'NGN',
    },
    select: { id: true },
  });

  const referrerWallet = await prisma.wallet.findUnique({
    where: { userId_currency: { userId: referrerId, currency: 'NGN' } },
    select: { id: true },
  });
  const referrerAvailable = referrerWallet
    ? await prisma.financialAccount.findFirst({
        where: {
          walletId: referrerWallet.id,
          purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
        },
        select: { id: true },
      })
    : null;

  for (const [index, entry] of REFERRALS.entries()) {
    const referredUserId = demoUser(users, entry.key);
    const referral = await prisma.referral.upsert({
      where: { referredUserId },
      update: {},
      create: {
        referrerUserId: referrerId,
        referredUserId,
        campaignId: campaign.id,
        code: referrerCode,
        status: entry.status,
        ...(entry.status === ReferralStatus.REWARDED
          ? { qualifiedAt: new Date(Date.now() - (index + 3) * 86_400_000) }
          : {}),
      },
    });

    if (entry.status !== ReferralStatus.REWARDED || !referrerAvailable) continue;

    const idempotencyKey = `referral-reward:${referral.id}:v1`;
    const existing = await prisma.referralReward.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) continue;

    // Posted before the reward row is written, so the reward always names a
    // transaction that exists.
    const posting = await prisma.ledgerTransaction.create({
      data: {
        idempotencyKey,
        reference: `SEEDREF-${referral.id.slice(-8)}`,
        description: 'Referral reward',
        currency: 'NGN',
        status: 'POSTED',
        postedAt: new Date(),
        initiatedByUserId: referrerId,
        entries: {
          create: [
            {
              accountId: expense.id,
              direction: 'DEBIT',
              amountMinor: REWARD_MINOR,
              currency: 'NGN',
              sequence: 1,
            },
            {
              accountId: referrerAvailable.id,
              direction: 'CREDIT',
              amountMinor: REWARD_MINOR,
              currency: 'NGN',
              sequence: 2,
            },
          ],
        },
      },
      select: { id: true },
    });

    await prisma.referralReward.create({
      data: {
        referralId: referral.id,
        amountMinor: REWARD_MINOR,
        currency: 'NGN',
        status: ReferralRewardStatus.RELEASED,
        idempotencyKey,
        ledgerTransactionId: posting.id,
        awardedAt: new Date(Date.now() - (index + 3) * 86_400_000),
      },
    });
  }
}
