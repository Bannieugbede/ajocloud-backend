import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { KycCheckStatus, type KycStatus, type KycTier } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionalNotificationService } from '../notifications/transactional-notification.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import {
  canGrantTier,
  isReviewable,
  reviewStatusForDecision,
  statusAfterDecision,
  type KycReviewDecision,
} from './domain/kyc-review-policy.js';
import type { ApproveKycProfileDto, ReviewKycProfileDto } from './dto/review-kyc-profile.dto.js';

/**
 * Compliance review of a KYC profile.
 *
 * Every decision is one serializable transaction that moves the profile,
 * closes the open ComplianceReview, and writes an audit entry plus an outbox
 * event. Nothing here reads or writes a raw identity number — the reviewer works
 * from the masked values and results that `KycService` already persisted.
 */
@Injectable()
export class KycReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly notifications: TransactionalNotificationService,
  ) {}

  /** The queue: profiles awaiting a decision, oldest submission first. */
  listQueue(limit = 50): Promise<unknown[]> {
    return this.prisma.kycProfile.findMany({
      where: { status: { in: ['PENDING', 'REQUIRES_REVIEW', 'EXPIRED'] } },
      select: {
        id: true,
        userId: true,
        status: true,
        tier: true,
        level: true,
        submittedAt: true,
        createdAt: true,
        _count: { select: { checks: true, documents: true } },
        reviews: {
          where: { status: 'OPEN' },
          select: { id: true, reason: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
  }

  /**
   * One profile with the evidence a reviewer needs. Checks expose their masked
   * identifier and result only — never a raw identifier, which is not persisted.
   */
  async getForReview(kycProfileId: string): Promise<unknown> {
    const profile = await this.prisma.kycProfile.findUnique({
      where: { id: kycProfileId },
      select: {
        id: true,
        userId: true,
        status: true,
        tier: true,
        level: true,
        submittedAt: true,
        verifiedAt: true,
        restrictedAt: true,
        createdAt: true,
        checks: {
          select: {
            id: true,
            type: true,
            provider: true,
            status: true,
            resultCode: true,
            maskedIdentifier: true,
            failureReason: true,
            riskFlags: true,
            submittedAt: true,
            checkedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        documents: { select: { id: true, type: true, expiresAt: true, createdAt: true } },
        reviews: {
          select: {
            id: true,
            reviewerId: true,
            status: true,
            reason: true,
            decidedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!profile) throw new NotFoundException('KYC profile was not found');
    return profile;
  }

  approve(reviewerId: string, kycProfileId: string, dto: ApproveKycProfileDto): Promise<unknown> {
    return this.decide(reviewerId, kycProfileId, 'APPROVE', dto.reason ?? 'Approved', dto.tier);
  }

  reject(reviewerId: string, kycProfileId: string, dto: ReviewKycProfileDto): Promise<unknown> {
    return this.decide(reviewerId, kycProfileId, 'REJECT', dto.reason);
  }

  requestInformation(
    reviewerId: string,
    kycProfileId: string,
    dto: ReviewKycProfileDto,
  ): Promise<unknown> {
    return this.decide(reviewerId, kycProfileId, 'REQUEST_INFORMATION', dto.reason);
  }

  escalate(reviewerId: string, kycProfileId: string, dto: ReviewKycProfileDto): Promise<unknown> {
    return this.decide(reviewerId, kycProfileId, 'ESCALATE', dto.reason);
  }

  private async decide(
    reviewerId: string,
    kycProfileId: string,
    decision: KycReviewDecision,
    reason: string,
    grantedTier?: KycTier,
  ): Promise<unknown> {
    const decided = await this.transactions.serializable(async (tx) => {
      const profile = await tx.kycProfile.findUnique({
        where: { id: kycProfileId },
        select: {
          id: true,
          userId: true,
          status: true,
          tier: true,
          checks: { where: { status: KycCheckStatus.PASSED }, select: { type: true } },
        },
      });
      if (!profile) throw new NotFoundException('KYC profile was not found');
      if (!isReviewable(profile.status)) {
        throw new ConflictException(`A profile with status ${profile.status} cannot be reviewed`);
      }

      const tier = grantedTier ?? profile.tier;
      if (decision === 'APPROVE') {
        const passed = profile.checks.map((check) => check.type as string);
        if (!canGrantTier(tier, passed)) {
          throw new UnprocessableEntityException(
            `Tier ${tier} requires passed verification checks the profile does not have`,
          );
        }
      }

      const nextStatus: KycStatus = statusAfterDecision(decision);
      const now = new Date();
      const updated = await tx.kycProfile.update({
        where: { id: kycProfileId },
        data: {
          status: nextStatus,
          ...(decision === 'APPROVE'
            ? { tier, level: this.levelForTier(tier), verifiedAt: now }
            : {}),
          ...(decision === 'REJECT' ? { restrictedAt: now } : {}),
        },
        select: {
          id: true,
          userId: true,
          status: true,
          tier: true,
          level: true,
          verifiedAt: true,
          restrictedAt: true,
        },
      });

      // An open review is the item the officer picked up; closing it with the
      // decision keeps one row per decision rather than leaving a stale OPEN row
      // beside a decided profile.
      const open = await tx.complianceReview.findFirst({
        where: { kycProfileId, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const reviewStatus = reviewStatusForDecision(decision);
      if (open) {
        await tx.complianceReview.update({
          where: { id: open.id },
          data: { reviewerId, status: reviewStatus, reason, decidedAt: now },
        });
      } else {
        await tx.complianceReview.create({
          data: { kycProfileId, reviewerId, status: reviewStatus, reason, decidedAt: now },
        });
      }

      const action = `kyc.profile.${decision.toLowerCase()}`;
      await this.audit(tx, reviewerId, kycProfileId, action, {
        fromStatus: profile.status,
        toStatus: nextStatus,
        ...(decision === 'APPROVE' ? { tier } : {}),
      });
      return { updated, subjectUserId: profile.userId, decidedAt: now };
    });

    // After the transaction, never inside it: telling someone they are verified
    // is not something that can be unsent if the decision rolls back.
    //
    // Only the settled outcomes are announced. REQUEST_INFORMATION and ESCALATE
    // move a profile without concluding it, and a push saying "verification
    // needs attention" for an internal escalation would be both alarming and
    // untrue.
    const template =
      decision === 'APPROVE' ? 'kyc-approved' : decision === 'REJECT' ? 'kyc-rejected' : null;
    if (template) {
      void this.notifications
        .notify({
          userId: decided.subjectUserId,
          template,
          variables: {},
          // The reviewer's reason is deliberately not carried: it is written for
          // an internal audit trail, and a push payload crosses Apple's and
          // Google's infrastructure and shows on a lock screen.
          storedPayload: { kycProfileId },
          // The decision instant, so a profile re-decided later notifies again
          // while a retried request within one decision does not.
          dedupeKey: `${template}:${kycProfileId}:${decided.decidedAt.toISOString()}`,
        })
        .catch(() => {
          // notify records its own failures; the decision stands either way.
        });
    }

    return decided.updated;
  }

  private levelForTier(tier: KycTier): number {
    return tier === 'TIER_3' ? 3 : tier === 'TIER_2' ? 2 : 1;
  }

  private async audit(
    tx: TransactionClient,
    actorUserId: string,
    kycProfileId: string,
    action: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: { actorUserId, action, subjectType: 'KycProfile', subjectId: kycProfileId, metadata },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'KycProfile',
        aggregateId: kycProfileId,
        eventType: action,
        payload: { kycProfileId, ...metadata },
      },
    });
  }
}
