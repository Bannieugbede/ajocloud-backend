import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccountType,
  FinancialAccountPurpose,
  KycCheckStatus,
  KycTier,
  ReferralRewardStatus,
  ReferralStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import {
  awardRefusalReason,
  rewardIdempotencyKey,
  rewardReversalIdempotencyKey,
  totalReleasedMinor,
  type CampaignTerms,
} from './domain/referral-reward-policy.js';

/** The rewards figure the app shows, alongside what produced it. */
export type ReferralSummary = {
  totalRewardMinor: string;
  currency: string;
  referralCount: number;
  qualifiedCount: number;
  code: string | null;
};

const TIER_RANK: Record<KycTier, 1 | 2 | 3> = {
  [KycTier.TIER_1]: 1,
  [KycTier.TIER_2]: 2,
  [KycTier.TIER_3]: 3,
};

/**
 * Issues referral rewards, and reverses them when the deposit that earned one
 * is undone.
 *
 * This is the only service that credits a member's wallet against platform
 * funds rather than moving money that already belonged to someone. Every
 * guarantee in ADR-012 is enforced here: the refusal rules before any posting,
 * the cap counted inside the same serializable transaction that inserts the
 * reward, and idempotency derived from state so a replayed deposit cannot pay
 * twice.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * What the member has earned. Read from posted reward rows, never recomputed
   * from campaign rules, so the figure on screen matches the ledger.
   */
  async summaryFor(userId: string): Promise<ReferralSummary> {
    const [user, referrals] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      }),
      this.prisma.referral.findMany({
        where: { referrerUserId: userId },
        select: {
          status: true,
          rewards: { select: { status: true, amountMinor: true, currency: true } },
        },
      }),
    ]);

    const rewards = referrals.flatMap((referral) => referral.rewards);
    return {
      totalRewardMinor: totalReleasedMinor(rewards).toString(),
      // Rewards are single-currency per campaign; the first released reward
      // names it, and NGN is the only campaign currency in use.
      currency: rewards.find((reward) => reward.status === 'RELEASED')?.currency ?? 'NGN',
      referralCount: referrals.length,
      qualifiedCount: referrals.filter(
        (referral) =>
          referral.status === ReferralStatus.QUALIFIED ||
          referral.status === ReferralStatus.REWARDED,
      ).length,
      // The code this member shares, not one they were referred by. Accounts
      // created before codes were issued have none until they are backfilled.
      code: user?.referralCode ?? null,
    };
  }

  /**
   * Considers a settled deposit for a referral reward.
   *
   * Called after the deposit has committed, never inside its transaction: a
   * reward must be based on money that has actually landed, and a failure here
   * must not roll back a deposit that succeeded. Returns quietly when there is
   * nothing to reward, which is the ordinary case.
   */
  async onDepositSettled(input: {
    userId: string;
    amountMinor: bigint;
    currency: string;
    /** The intent that settled; ties the reward to its cause. */
    paymentIntentId: string;
    occurredAt: Date;
  }): Promise<{ awarded: boolean; reason?: string }> {
    const referral = await this.prisma.referral.findUnique({
      where: { referredUserId: input.userId },
      select: { id: true, referrerUserId: true, status: true, campaignId: true },
    });
    // Most users were not referred. This is the common path and costs one
    // indexed lookup.
    if (!referral) return { awarded: false };

    // A referral that already paid, or was already refused, is not reconsidered
    // by a second deposit: the reward is for the first one.
    if (referral.status === ReferralStatus.REWARDED) {
      return { awarded: false, reason: 'already rewarded' };
    }
    if (referral.status === ReferralStatus.REJECTED) {
      return { awarded: false, reason: 'previously rejected' };
    }

    const campaign = await this.eligibleCampaign(referral.campaignId, input.occurredAt);
    if (!campaign) return { awarded: false, reason: 'no eligible campaign' };

    try {
      return await this.transactions.serializable(async (tx) =>
        this.awardWithin(tx, { ...input, referral, campaign }),
      );
    } catch (cause) {
      // A reward that cannot be issued must never fail the deposit that earned
      // it. The deposit has already committed; this is recorded and dropped.
      this.logger.error(
        { referralId: referral.id, err: cause },
        'Referral reward could not be issued',
      );
      return { awarded: false, reason: 'reward failed' };
    }
  }

  private async awardWithin(
    tx: TransactionClient,
    input: {
      userId: string;
      amountMinor: bigint;
      currency: string;
      paymentIntentId: string;
      occurredAt: Date;
      referral: { id: string; referrerUserId: string; campaignId: string | null };
      campaign: CampaignTerms;
    },
  ): Promise<{ awarded: boolean; reason?: string }> {
    const { referral, campaign } = input;
    const idempotencyKey = rewardIdempotencyKey(referral.id, campaign.version);

    // Idempotency first, before any check that depends on state this award
    // itself changes. A retry must find the existing reward rather than be
    // told it has hit the cap that its own first run filled.
    const existing = await tx.referralReward.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return { awarded: false, reason: 'already awarded' };

    const refusal = awardRefusalReason(campaign, {
      selfReferral: referral.referrerUserId === input.userId,
      duplicateIdentity: await this.hasDuplicateIdentity(tx, input.userId),
      referredUserKycTier: await this.kycTierOf(tx, input.userId),
      depositAmountMinor: input.amountMinor,
      depositCurrency: input.currency,
      // Counted inside this serializable transaction, so two deposits settling
      // at once cannot both pass a check for the final remaining slot.
      referrerRewardCount: await this.releasedRewardCount(tx, referral.referrerUserId, campaign.id),
      occurredAt: input.occurredAt,
    });

    if (refusal) {
      await tx.referral.update({
        where: { id: referral.id },
        data: { status: ReferralStatus.REJECTED },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.userId,
          action: 'referral.rejected',
          subjectType: 'Referral',
          subjectId: referral.id,
          // The reason is the only evidence of which control fired.
          metadata: { reason: refusal },
        },
      });
      return { awarded: false, reason: refusal };
    }

    // Record what qualified the referral before paying for it, so a reward can
    // always be traced to the settled activity that earned it.
    await tx.referralQualification.create({
      data: {
        referralId: referral.id,
        qualifyingEventId: input.paymentIntentId,
        qualifyingProduct: 'WALLET',
        qualifyingEvent: 'deposit.settled',
        settledAmountMinor: input.amountMinor,
        currency: input.currency,
        occurredAt: input.occurredAt,
      },
    });

    const accounts = await this.rewardAccounts(tx, referral.referrerUserId, campaign);
    const posting = await this.ledger.postWithin(tx, {
      idempotencyKey,
      reference: `REFREWARD-${randomUUID()}`,
      description: 'Referral reward',
      currency: campaign.rewardCurrency,
      initiatedByUserId: referral.referrerUserId,
      entries: [
        {
          accountId: accounts.expense.id,
          direction: 'DEBIT',
          amountMinor: campaign.rewardAmountMinor,
        },
        {
          accountId: accounts.referrerAvailable.id,
          direction: 'CREDIT',
          amountMinor: campaign.rewardAmountMinor,
        },
      ],
    });

    await tx.referralReward.create({
      data: {
        referralId: referral.id,
        amountMinor: campaign.rewardAmountMinor,
        currency: campaign.rewardCurrency,
        status: ReferralRewardStatus.RELEASED,
        idempotencyKey,
        ledgerTransactionId: posting.id,
        awardedAt: input.occurredAt,
      },
    });

    await tx.referral.update({
      where: { id: referral.id },
      data: { status: ReferralStatus.REWARDED, qualifiedAt: input.occurredAt },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: referral.referrerUserId,
        action: 'referral.rewarded',
        subjectType: 'Referral',
        subjectId: referral.id,
      },
    });

    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Referral',
        aggregateId: referral.id,
        eventType: 'referral.rewarded',
        payload: {
          referralId: referral.id,
          amountMinor: campaign.rewardAmountMinor.toString(),
          currency: campaign.rewardCurrency,
        },
      },
    });

    return { awarded: true };
  }

  /**
   * Claws a reward back when the deposit that earned it is reversed.
   *
   * Without this, deposit-then-withdraw is a money pump. The reversal is a new
   * posting rather than an edit: the ledger is append-only, and that a reward
   * was paid and then withdrawn is itself a fact worth keeping.
   */
  async onDepositReversed(paymentIntentId: string): Promise<{ reversed: boolean }> {
    const qualification = await this.prisma.referralQualification.findFirst({
      where: { qualifyingEventId: paymentIntentId, reversedAt: null },
      select: { id: true, referralId: true },
    });
    if (!qualification) return { reversed: false };

    return this.transactions.serializable(async (tx) => {
      const reward = await tx.referralReward.findFirst({
        where: {
          referralId: qualification.referralId,
          status: ReferralRewardStatus.RELEASED,
        },
        select: { id: true, ledgerTransactionId: true },
      });
      if (!reward?.ledgerTransactionId) return { reversed: false };

      await this.ledger.reverse(
        reward.ledgerTransactionId,
        rewardReversalIdempotencyKey(reward.id),
        'Referral reward reversed: qualifying deposit was reversed',
      );

      await tx.referralReward.update({
        where: { id: reward.id },
        data: { status: ReferralRewardStatus.REVERSED },
      });
      await tx.referralQualification.update({
        where: { id: qualification.id },
        data: { reversedAt: new Date() },
      });
      await tx.referral.update({
        where: { id: qualification.referralId },
        data: { status: ReferralStatus.REJECTED },
      });
      await tx.auditLog.create({
        data: {
          action: 'referral.reward_reversed',
          subjectType: 'ReferralReward',
          subjectId: reward.id,
        },
      });
      return { reversed: true };
    });
  }

  /** The campaign in force for this event, or null when none applies. */
  private async eligibleCampaign(
    campaignId: string | null,
    occurredAt: Date,
  ): Promise<CampaignTerms | null> {
    const row = campaignId
      ? await this.prisma.referralCampaign.findUnique({ where: { id: campaignId } })
      : await this.prisma.referralCampaign.findFirst({
          where: {
            status: 'ACTIVE',
            effectiveAt: { lte: occurredAt },
            OR: [{ expiresAt: null }, { expiresAt: { gte: occurredAt } }],
          },
          orderBy: { effectiveAt: 'desc' },
        });
    if (!row) return null;

    return {
      id: row.id,
      version: row.version,
      status: row.status,
      rewardAmountMinor: row.rewardAmountMinor,
      rewardCurrency: row.rewardCurrency,
      maximumRewards: row.maximumRewards,
      requiredKycTier: TIER_RANK[row.requiredKycTier],
      minimumAmountMinor: row.minimumAmountMinor,
      effectiveAt: row.effectiveAt,
      expiresAt: row.expiresAt,
    };
  }

  /** Rewards already released to this referrer under this campaign. */
  private async releasedRewardCount(
    tx: TransactionClient,
    referrerUserId: string,
    campaignId: string,
  ): Promise<number> {
    return tx.referralReward.count({
      where: {
        status: ReferralRewardStatus.RELEASED,
        referral: { referrerUserId, campaignId },
      },
    });
  }

  /**
   * Whether the referred user's verified identity is already attached to
   * another account — the signature of one person farming referrals across
   * several signups.
   */
  private async hasDuplicateIdentity(tx: TransactionClient, userId: string): Promise<boolean> {
    // Matched on the masked identifier, which is all that is retained: ADR-004
    // forbids persisting a raw BVN or NIN, so the comparison is between the
    // masked values two accounts would share if they belonged to one person.
    const checks = await tx.kycCheck.findMany({
      where: {
        profile: { userId },
        status: KycCheckStatus.PASSED,
        maskedIdentifier: { not: null },
      },
      select: { maskedIdentifier: true, type: true },
    });
    if (!checks.length) return false;

    const shared = await tx.kycCheck.count({
      where: {
        profile: { userId: { not: userId } },
        status: KycCheckStatus.PASSED,
        OR: checks.map((check) => ({
          type: check.type,
          maskedIdentifier: check.maskedIdentifier,
        })),
      },
    });
    return shared > 0;
  }

  private async kycTierOf(tx: TransactionClient, userId: string): Promise<1 | 2 | 3> {
    const profile = await tx.kycProfile.findUnique({
      where: { userId },
      select: { tier: true },
    });
    return profile ? TIER_RANK[profile.tier] : 1;
  }

  /**
   * The two sides of a reward posting: the platform's expense account and the
   * referrer's spendable balance.
   */
  private async rewardAccounts(
    tx: TransactionClient,
    referrerUserId: string,
    campaign: CampaignTerms,
  ) {
    const wallet = await tx.wallet.findFirst({
      where: { userId: referrerUserId, currency: campaign.rewardCurrency },
      select: { id: true },
    });
    if (!wallet) throw new Error('The referring user has no wallet in the reward currency');

    const referrerAvailable = await tx.financialAccount.findFirstOrThrow({
      where: { walletId: wallet.id, purpose: FinancialAccountPurpose.WALLET_AVAILABLE },
      select: { id: true },
    });

    // Created on first use rather than assumed: a reward must not fail because
    // an account nobody has needed yet was never seeded.
    const code = `PLATFORM:REFERRAL_REWARD_EXPENSE:${campaign.rewardCurrency}`;
    const expense = await tx.financialAccount.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name: 'Referral reward expense',
        type: AccountType.EXPENSE,
        purpose: FinancialAccountPurpose.REFERRAL_REWARD_EXPENSE,
        currency: campaign.rewardCurrency,
      },
      select: { id: true },
    });

    return { referrerAvailable, expense };
  }
}
