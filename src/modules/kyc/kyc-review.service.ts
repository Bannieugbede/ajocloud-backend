import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycCheckStatus, type KycStatus, type KycTier } from '../../../generated/prisma/enums.js';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TransactionalNotificationService } from '../notifications/transactional-notification.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import { decryptDocument, documentKey } from './domain/identity-document.js';
import { completedLevel, tierForLevel } from './domain/kyc-stage-policy.js';
import { NIN_DOCUMENT_TYPES, readKycFacts } from './kyc-facts.js';
import {
  canGrantTier,
  checkTypesApprovedBy,
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
    private readonly config: ConfigService<Environment, true>,
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
            // The addresses compared at stage 3; never an identity number.
            resultSummary: true,
            submittedAt: true,
            checkedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        documents: {
          select: {
            id: true,
            type: true,
            contentType: true,
            sizeBytes: true,
            supersededAt: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
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

  /**
   * One uploaded document, decrypted for a reviewer. Every view is audited:
   * a photo of an identity document is the most sensitive thing held, and who
   * looked at it, when, is part of the record.
   */
  async getDocument(
    reviewerId: string,
    kycProfileId: string,
    documentId: string,
  ): Promise<{ id: string; type: string; contentType: string; data: string }> {
    const document = await this.prisma.verificationDocument.findFirst({
      where: { id: documentId, kycProfileId },
      select: { id: true, type: true, contentType: true, ciphertext: true },
    });
    if (!document?.ciphertext || !document.contentType) {
      throw new NotFoundException('Document was not found');
    }
    const key = documentKey(this.config.get('TOKEN_PEPPER', { infer: true }));
    const plain = decryptDocument(Buffer.from(document.ciphertext), key);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: reviewerId,
        action: 'kyc.document.viewed',
        subjectType: 'VerificationDocument',
        subjectId: document.id,
        metadata: { kycProfileId, type: document.type },
      },
    });
    return {
      id: document.id,
      type: document.type,
      contentType: document.contentType,
      data: plain.toString('base64'),
    };
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
          checks: {
            where: { status: { in: [KycCheckStatus.PASSED, KycCheckStatus.PENDING] } },
            select: { id: true, type: true, status: true },
          },
          documents: {
            where: { type: { in: [...NIN_DOCUMENT_TYPES] }, supersededAt: null },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!profile) throw new NotFoundException('KYC profile was not found');
      if (!isReviewable(profile.status)) {
        throw new ConflictException(`A profile with status ${profile.status} cannot be reviewed`);
      }

      const tier = grantedTier ?? profile.tier;
      const now = new Date();
      const held = profile.checks.filter((check) => check.status === KycCheckStatus.PENDING);
      if (decision === 'APPROVE') {
        const evidence = {
          checkTypes: profile.checks.map((check) => check.type as string),
          hasNinDocument: profile.documents.length > 0,
        };
        if (!canGrantTier(tier, evidence)) {
          throw new UnprocessableEntityException(
            `Tier ${tier} requires verification evidence the profile does not have`,
          );
        }
        // Approving is what passes a check held for review, and only the
        // checks the granted tier rests on.
        const approved: readonly string[] = checkTypesApprovedBy(tier);
        const passing = held.filter((check) => approved.includes(check.type));
        if (passing.length > 0) {
          await tx.kycCheck.updateMany({
            where: { id: { in: passing.map((check) => check.id) } },
            data: { status: KycCheckStatus.PASSED, reviewerUserId: reviewerId, checkedAt: now },
          });
        }
      } else if (decision === 'REJECT' || decision === 'REQUEST_INFORMATION') {
        // A held check that is not approved fails, so the person can submit
        // again rather than wait on a review that has ended.
        if (held.length > 0) {
          await tx.kycCheck.updateMany({
            where: { id: { in: held.map((check) => check.id) } },
            data: {
              status: KycCheckStatus.FAILED,
              reviewerUserId: reviewerId,
              checkedAt: now,
              failureReason: decision === 'REJECT' ? 'REJECTED_BY_REVIEW' : 'INFORMATION_REQUESTED',
            },
          });
        }
      }

      const nextStatus: KycStatus = statusAfterDecision(decision);
      // The stored tier follows the evidence as it stands after this decision,
      // never beyond it, whatever tier was named.
      const facts = await readKycFacts(tx, profile.userId);
      const level = completedLevel({
        ...facts,
        restricted: facts.restricted || decision === 'REJECT',
      });
      const updated = await tx.kycProfile.update({
        where: { id: kycProfileId },
        data: {
          status: nextStatus,
          tier: tierForLevel(level),
          level,
          ...(decision === 'APPROVE' ? { verifiedAt: now } : {}),
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
