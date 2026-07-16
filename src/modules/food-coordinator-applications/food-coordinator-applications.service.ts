import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FoodCoordinatorApplicationStatus,
  KycStatus,
  KycTier,
} from '../../../generated/prisma/enums.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import type { CreateFoodCoordinatorApplicationDto } from './dto/create-food-coordinator-application.dto.js';
import type { UpdateFoodCoordinatorApplicationDto } from './dto/update-food-coordinator-application.dto.js';
import type {
  ApproveFoodCoordinatorApplicationDto,
  ReviewFoodCoordinatorApplicationDto,
} from './dto/review-food-coordinator-application.dto.js';

const applicantSelect = {
  id: true,
  status: true,
  personalDetails: true,
  businessDetails: true,
  operatingLocation: true,
  fulfilmentLocations: true,
  settlementBankCode: true,
  settlementAccountMasked: true,
  submittedAt: true,
  approvedAt: true,
  expiresAt: true,
  rejectionReason: true,
  suspensionReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class FoodCoordinatorApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  async create(userId: string, dto: CreateFoodCoordinatorApplicationDto): Promise<unknown> {
    const active = await this.prisma.foodCoordinatorApplication.findFirst({
      where: {
        userId,
        status: {
          notIn: [
            FoodCoordinatorApplicationStatus.REJECTED,
            FoodCoordinatorApplicationStatus.REVOKED,
            FoodCoordinatorApplicationStatus.EXPIRED,
          ],
        },
      },
      select: { id: true },
    });
    if (active) throw new ConflictException('An active coordinator application already exists');
    return this.prisma.foodCoordinatorApplication.create({
      data: {
        userId,
        personalDetails: this.asJson(dto.personalDetails),
        ...(dto.businessDetails ? { businessDetails: this.asJson(dto.businessDetails) } : {}),
        operatingLocation: this.asJson(dto.operatingLocation),
        fulfilmentLocations: this.asJson(dto.fulfilmentLocations),
        ...(dto.settlementBankCode ? { settlementBankCode: dto.settlementBankCode } : {}),
        ...(dto.settlementAccountMasked
          ? { settlementAccountMasked: dto.settlementAccountMasked }
          : {}),
        ...(dto.verificationConsent ? { verificationConsentAt: new Date() } : {}),
        ...(dto.termsAccepted ? { termsAcceptedAt: new Date() } : {}),
      },
      select: applicantSelect,
    });
  }

  listMine(userId: string): Promise<unknown[]> {
    return this.prisma.foodCoordinatorApplication.findMany({
      where: { userId },
      select: applicantSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    userId: string,
    applicationId: string,
    dto: UpdateFoodCoordinatorApplicationDto,
  ): Promise<unknown> {
    const application = await this.prisma.foodCoordinatorApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Coordinator application was not found');
    if (application.userId !== userId) throw new ForbiddenException('Application is not yours');
    if (
      application.status !== FoodCoordinatorApplicationStatus.DRAFT &&
      application.status !== FoodCoordinatorApplicationStatus.MORE_INFORMATION_REQUIRED
    ) {
      throw new ConflictException('Only editable applications can be updated');
    }
    return this.prisma.foodCoordinatorApplication.update({
      where: { id: applicationId },
      data: {
        ...(dto.personalDetails ? { personalDetails: this.asJson(dto.personalDetails) } : {}),
        ...(dto.businessDetails ? { businessDetails: this.asJson(dto.businessDetails) } : {}),
        ...(dto.operatingLocation ? { operatingLocation: this.asJson(dto.operatingLocation) } : {}),
        ...(dto.fulfilmentLocations
          ? { fulfilmentLocations: this.asJson(dto.fulfilmentLocations) }
          : {}),
        ...(dto.settlementBankCode ? { settlementBankCode: dto.settlementBankCode } : {}),
        ...(dto.settlementAccountMasked
          ? { settlementAccountMasked: dto.settlementAccountMasked }
          : {}),
        ...(dto.verificationConsent ? { verificationConsentAt: new Date() } : {}),
        ...(dto.termsAccepted ? { termsAcceptedAt: new Date() } : {}),
      },
      select: applicantSelect,
    });
  }

  async submit(userId: string, applicationId: string): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const application = await tx.foodCoordinatorApplication.findUnique({
        where: { id: applicationId },
      });
      if (!application) throw new NotFoundException('Coordinator application was not found');
      if (application.userId !== userId) throw new ForbiddenException('Application is not yours');
      if (
        application.status !== FoodCoordinatorApplicationStatus.DRAFT &&
        application.status !== FoodCoordinatorApplicationStatus.MORE_INFORMATION_REQUIRED
      ) {
        throw new ConflictException('Application cannot be submitted in its current state');
      }
      if (
        !application.verificationConsentAt ||
        !application.termsAcceptedAt ||
        !application.settlementBankCode ||
        !application.settlementAccountMasked
      ) {
        throw new UnprocessableEntityException(
          'Consent, terms acceptance, and masked settlement details are required',
        );
      }
      const updated = await tx.foodCoordinatorApplication.update({
        where: { id: applicationId },
        data: {
          status: FoodCoordinatorApplicationStatus.AUTOMATED_REVIEW,
          submittedAt: new Date(),
        },
        select: applicantSelect,
      });
      await this.audit(tx, userId, applicationId, 'food.coordinator.application.submitted');
      return updated;
    });
  }

  listForReview(): Promise<unknown[]> {
    return this.prisma.foodCoordinatorApplication.findMany({
      where: { status: { not: FoodCoordinatorApplicationStatus.DRAFT } },
      include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { submittedAt: 'asc' },
      take: 100,
    });
  }

  async getForReview(applicationId: string): Promise<unknown> {
    const application = await this.prisma.foodCoordinatorApplication.findUnique({
      where: { id: applicationId },
      include: { documents: true, reviews: { orderBy: { createdAt: 'asc' } } },
    });
    if (!application) throw new NotFoundException('Coordinator application was not found');
    return application;
  }

  requestInformation(
    reviewerUserId: string,
    applicationId: string,
    dto: ReviewFoodCoordinatorApplicationDto,
  ): Promise<unknown> {
    return this.reviewTransition(
      reviewerUserId,
      applicationId,
      FoodCoordinatorApplicationStatus.MORE_INFORMATION_REQUIRED,
      dto,
    );
  }

  reject(
    reviewerUserId: string,
    applicationId: string,
    dto: ReviewFoodCoordinatorApplicationDto,
  ): Promise<unknown> {
    return this.reviewTransition(
      reviewerUserId,
      applicationId,
      FoodCoordinatorApplicationStatus.REJECTED,
      dto,
    );
  }

  async suspend(
    reviewerUserId: string,
    applicationId: string,
    dto: ReviewFoodCoordinatorApplicationDto,
  ): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const application = await tx.foodCoordinatorApplication.findUnique({
        where: { id: applicationId },
      });
      if (!application) throw new NotFoundException('Coordinator application was not found');
      if (application.status !== FoodCoordinatorApplicationStatus.APPROVED) {
        throw new ConflictException('Only an approved coordinator can be suspended');
      }
      const updated = await tx.foodCoordinatorApplication.update({
        where: { id: applicationId },
        data: {
          status: FoodCoordinatorApplicationStatus.SUSPENDED,
          suspensionReason: dto.notes,
        },
        select: applicantSelect,
      });
      const kyc = await tx.kycProfile.findUnique({ where: { userId: application.userId } });
      if (kyc) {
        await tx.foodCoordinatorProfile.updateMany({
          where: { kycProfileId: kyc.id },
          data: { status: KycStatus.REQUIRES_REVIEW },
        });
      }
      await tx.foodCoordinatorReview.create({
        data: {
          applicationId,
          reviewerUserId,
          fromStatus: application.status,
          toStatus: FoodCoordinatorApplicationStatus.SUSPENDED,
          notes: dto.notes,
          ...(dto.riskResult ? { riskResult: this.asJson(dto.riskResult) } : {}),
        },
      });
      await this.audit(tx, reviewerUserId, applicationId, 'food.coordinator.application.suspended');
      return updated;
    });
  }

  async approve(
    reviewerUserId: string,
    applicationId: string,
    dto: ApproveFoodCoordinatorApplicationDto,
  ): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const application = await tx.foodCoordinatorApplication.findUnique({
        where: { id: applicationId },
      });
      if (!application) throw new NotFoundException('Coordinator application was not found');
      if (
        application.status !== FoodCoordinatorApplicationStatus.AUTOMATED_REVIEW &&
        application.status !== FoodCoordinatorApplicationStatus.MANUAL_REVIEW
      ) {
        throw new ConflictException('Application is not ready for approval');
      }
      const kyc = await tx.kycProfile.findUnique({ where: { userId: application.userId } });
      if (!kyc || kyc.status !== KycStatus.VERIFIED || kyc.tier !== KycTier.TIER_3) {
        throw new UnprocessableEntityException('Verified Tier 3 KYC is required');
      }
      const now = new Date();
      const expiresAt = new Date(dto.expiresAt);
      if (expiresAt <= now)
        throw new UnprocessableEntityException('Approval expiry must be future');
      const updated = await tx.foodCoordinatorApplication.update({
        where: { id: applicationId },
        data: {
          status: FoodCoordinatorApplicationStatus.APPROVED,
          identityVerificationRef: dto.identityVerificationRef,
          settlementVerificationRef: dto.settlementVerificationRef,
          riskAssessmentRef: dto.riskAssessmentRef,
          identityVerifiedAt: now,
          bankVerifiedAt: now,
          riskResult: this.asJson(dto.riskResult ?? {}),
          approvedAt: now,
          expiresAt,
        },
        select: applicantSelect,
      });
      await tx.foodCoordinatorReview.create({
        data: {
          applicationId,
          reviewerUserId,
          fromStatus: application.status,
          toStatus: FoodCoordinatorApplicationStatus.APPROVED,
          notes: dto.notes,
          riskResult: this.asJson(dto.riskResult ?? {}),
        },
      });
      await tx.foodCoordinatorProfile.upsert({
        where: { kycProfileId: kyc.id },
        create: { kycProfileId: kyc.id, status: KycStatus.VERIFIED, approvedAt: now },
        update: { status: KycStatus.VERIFIED, approvedAt: now },
      });
      await this.audit(tx, reviewerUserId, applicationId, 'food.coordinator.application.approved');
      return updated;
    });
  }

  private async reviewTransition(
    reviewerUserId: string,
    applicationId: string,
    toStatus: FoodCoordinatorApplicationStatus,
    dto: ReviewFoodCoordinatorApplicationDto,
  ): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const application = await tx.foodCoordinatorApplication.findUnique({
        where: { id: applicationId },
      });
      if (!application) throw new NotFoundException('Coordinator application was not found');
      if (
        application.status === FoodCoordinatorApplicationStatus.DRAFT ||
        application.status === FoodCoordinatorApplicationStatus.APPROVED ||
        application.status === FoodCoordinatorApplicationStatus.REVOKED ||
        application.status === FoodCoordinatorApplicationStatus.EXPIRED
      ) {
        throw new ConflictException('Application cannot be reviewed in its current state');
      }
      const updated = await tx.foodCoordinatorApplication.update({
        where: { id: applicationId },
        data: {
          status: toStatus,
          ...(toStatus === FoodCoordinatorApplicationStatus.REJECTED
            ? { rejectionReason: dto.notes }
            : {}),
        },
        select: applicantSelect,
      });
      await tx.foodCoordinatorReview.create({
        data: {
          applicationId,
          reviewerUserId,
          fromStatus: application.status,
          toStatus,
          notes: dto.notes,
          ...(dto.riskResult ? { riskResult: this.asJson(dto.riskResult) } : {}),
        },
      });
      await this.audit(
        tx,
        reviewerUserId,
        applicationId,
        `food.coordinator.application.${toStatus.toLowerCase()}`,
      );
      return updated;
    });
  }

  private async audit(
    tx: TransactionClient,
    actorUserId: string,
    applicationId: string,
    action: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId,
        action,
        subjectType: 'FoodCoordinatorApplication',
        subjectId: applicationId,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'FoodCoordinatorApplication',
        aggregateId: applicationId,
        eventType: action,
        payload: { applicationId },
      },
    });
  }

  private asJson(value: Record<string, unknown>): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
