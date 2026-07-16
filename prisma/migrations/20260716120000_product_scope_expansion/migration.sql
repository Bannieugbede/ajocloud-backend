-- CreateEnum
CREATE TYPE "KycTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('BVN', 'NIN', 'VNIN', 'BANK_ACCOUNT', 'FACE_MATCH', 'LIVENESS', 'ADDRESS', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "FinancialAccountPurpose" AS ENUM ('WALLET_AVAILABLE', 'WALLET_RESERVED', 'PROVIDER_PAYABLE', 'PLATFORM_FEE_REVENUE', 'REFERRAL_REWARD_EXPENSE');

-- CreateEnum
CREATE TYPE "FoodCoordinatorApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'AUTOMATED_REVIEW', 'MANUAL_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FoodFulfilmentMethod" AS ENUM ('DELIVERY', 'PICKUP', 'DELIVERY_OR_PICKUP');

-- CreateEnum
CREATE TYPE "SavingsGoalType" AS ENUM ('FLEXIBLE', 'TARGET', 'LOCKED');

-- CreateEnum
CREATE TYPE "ReferralCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING', 'APPROVED', 'RELEASED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BillPaymentStatus" AS ENUM ('CREATED', 'VALIDATING', 'VALIDATED', 'PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REVERSED', 'REFUND_PENDING', 'REFUNDED', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "BillPaymentAttemptStatus" AS ENUM ('PENDING', 'SENT', 'CONFIRMED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReconciliationState" AS ENUM ('NOT_REQUIRED', 'PENDING', 'MATCHED', 'MISMATCHED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "BillCatalogStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "AjoContributionMode" AS ENUM ('FIXED', 'FLEXIBLE_UNIT');

-- CreateEnum
CREATE TYPE "SwapInitiatorType" AS ENUM ('MEMBER', 'ADMINISTRATOR');

-- CreateEnum
CREATE TYPE "ScheduleVersionReason" AS ENUM ('INITIAL_LOCK', 'APPROVED_SWAP', 'ADMINISTRATIVE_CORRECTION');

-- DropIndex
DROP INDEX "payout_schedules_cycleId_key";

-- DropIndex
DROP INDEX "payout_schedules_slotId_key";

-- DropIndex
DROP INDEX "fee_definitions_code_key";

-- DropIndex
DROP INDEX "kyc_checks_kycProfileId_status_idx";

-- Replace the legacy global provider-reference uniqueness with provider-scoped uniqueness.
DROP INDEX "kyc_checks_providerRef_key";

-- AlterTable
ALTER TABLE "swap_requests" ADD COLUMN     "feeAssessmentId" UUID,
ADD COLUMN     "initiatedByUserId" UUID,
ADD COLUMN     "initiatorType" "SwapInitiatorType" NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "originalFromPosition" INTEGER,
ADD COLUMN     "originalToPosition" INTEGER,
ADD COLUMN     "previousScheduleVersion" INTEGER,
ADD COLUMN     "proposedFromPosition" INTEGER,
ADD COLUMN     "proposedToPosition" INTEGER,
ADD COLUMN     "resultingScheduleVersion" INTEGER,
ADD COLUMN     "reviewNotes" VARCHAR(1000),
ADD COLUMN     "reviewedByUserId" UUID;

-- Backfill immutable swap context before enforcing the new required columns.
UPDATE "swap_requests" AS request
SET "initiatedByUserId" = member."userId",
    "originalFromPosition" = source."position",
    "originalToPosition" = target."position",
    "proposedFromPosition" = target."position",
    "proposedToPosition" = source."position",
    "previousScheduleVersion" = request."scheduleVersion"
FROM "ajo_group_members" AS member,
     "ajo_slots" AS source,
     "ajo_slots" AS target
WHERE member."id" = request."requestedByMemberId"
  AND source."id" = request."fromSlotId"
  AND target."id" = request."toSlotId";

ALTER TABLE "swap_requests"
ALTER COLUMN "initiatedByUserId" SET NOT NULL,
ALTER COLUMN "originalFromPosition" SET NOT NULL,
ALTER COLUMN "originalToPosition" SET NOT NULL,
ALTER COLUMN "previousScheduleVersion" SET NOT NULL,
ALTER COLUMN "proposedFromPosition" SET NOT NULL,
ALTER COLUMN "proposedToPosition" SET NOT NULL;

-- AlterTable
ALTER TABLE "ajo_groups" ADD COLUMN     "businessTimezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Lagos',
ADD COLUMN     "contributionCloseOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contributionMode" "AjoContributionMode" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "contributionOpenOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contributionUnitMinor" BIGINT,
ADD COLUMN     "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateThresholdMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maxMembers" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "maxSlotsPerMember" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "minSlotsPerMember" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "numberOfCycles" INTEGER,
ADD COLUMN     "payoutEligibilityCutoffMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payoutOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payoutProcessingWindowMinutes" INTEGER NOT NULL DEFAULT 1440;

-- AlterTable
ALTER TABLE "ajo_cycles" ADD COLUMN     "contributionClosesAt" TIMESTAMPTZ(6),
ADD COLUMN     "contributionOpensAt" TIMESTAMPTZ(6),
ADD COLUMN     "graceEndsAt" TIMESTAMPTZ(6),
ADD COLUMN     "payoutEligibilityCutoffAt" TIMESTAMPTZ(6),
ADD COLUMN     "payoutProcessingEndsAt" TIMESTAMPTZ(6);

UPDATE "ajo_cycles"
SET "contributionOpensAt" = "contributionDueAt",
    "contributionClosesAt" = "contributionDueAt",
    "graceEndsAt" = "contributionDueAt",
    "payoutEligibilityCutoffAt" = "payoutDueAt",
    "payoutProcessingEndsAt" = "payoutDueAt" + INTERVAL '24 hours';

ALTER TABLE "ajo_cycles"
ALTER COLUMN "contributionClosesAt" SET NOT NULL,
ALTER COLUMN "contributionOpensAt" SET NOT NULL,
ALTER COLUMN "graceEndsAt" SET NOT NULL,
ALTER COLUMN "payoutEligibilityCutoffAt" SET NOT NULL,
ALTER COLUMN "payoutProcessingEndsAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "allocatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "gatewayConfirmedAt" TIMESTAMPTZ(6),
ADD COLUMN     "paidAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN     "completedAt" TIMESTAMPTZ(6),
ADD COLUMN     "failedAt" TIMESTAMPTZ(6),
ADD COLUMN     "initiatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "reversedAt" TIMESTAMPTZ(6),
ADD COLUMN     "scheduledAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "savings_goals" ADD COLUMN     "autoSaveEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maturityAt" TIMESTAMPTZ(6),
ADD COLUMN     "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "type" "SavingsGoalType" NOT NULL DEFAULT 'TARGET';

-- AlterTable
ALTER TABLE "fee_definitions" ADD COLUMN     "chargeEvent" VARCHAR(80),
ADD COLUMN     "effectiveAt" TIMESTAMPTZ(6),
ADD COLUMN     "expiresAt" TIMESTAMPTZ(6),
ADD COLUMN     "maximumMinor" BIGINT,
ADD COLUMN     "minimumMinor" BIGINT,
ADD COLUMN     "payerType" VARCHAR(64),
ADD COLUMN     "refundable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxTreatment" VARCHAR(120),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "fee_definitions"
SET "chargeEvent" = 'LEGACY_UNSPECIFIED',
    "payerType" = 'LEGACY_UNSPECIFIED',
    "effectiveAt" = "createdAt";

ALTER TABLE "fee_definitions"
ALTER COLUMN "chargeEvent" SET NOT NULL,
ALTER COLUMN "payerType" SET NOT NULL,
ALTER COLUMN "effectiveAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "fee_assessments" ADD COLUMN     "calculationBaseMinor" BIGINT,
ADD COLUMN     "ruleSnapshot" JSONB;

UPDATE "fee_assessments" AS assessment
SET "ruleSnapshot" = jsonb_build_object(
  'code', definition."code",
  'version', definition."version",
  'calculationType', definition."calculationType",
  'amountMinor', definition."amountMinor"::text,
  'basisPoints', definition."basisPoints",
  'migration', 'legacy-backfill'
)
FROM "fee_definitions" AS definition
WHERE definition."id" = assessment."feeDefinitionId";

ALTER TABLE "fee_assessments" ALTER COLUMN "ruleSnapshot" SET NOT NULL;

-- AlterTable
ALTER TABLE "food_ajo_groups" ADD COLUMN     "activatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "contributionFrequency" "ContributionFrequency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "distributionAt" TIMESTAMPTZ(6),
ADD COLUMN     "enrolmentCapacity" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "fulfilmentMethod" "FoodFulfilmentMethod" NOT NULL DEFAULT 'PICKUP',
ADD COLUMN     "plannedProcurementAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "food_packages" ADD COLUMN     "priceLockedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "food_subscriptions" ADD COLUMN     "fulfilmentMethod" "FoodFulfilmentMethod" NOT NULL DEFAULT 'PICKUP';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "foodAjoGroupId" UUID;

-- AlterTable
ALTER TABLE "distribution_confirmations" ADD COLUMN     "evidenceStorageKey" VARCHAR(500),
ADD COLUMN     "expiresAt" TIMESTAMPTZ(6),
ADD COLUMN     "usedAt" TIMESTAMPTZ(6);

UPDATE "distribution_confirmations"
SET "expiresAt" = "confirmedAt",
    "usedAt" = "confirmedAt";

ALTER TABLE "distribution_confirmations" ALTER COLUMN "expiresAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "country" CHAR(2) NOT NULL DEFAULT 'NG',
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "otherNames" VARCHAR(160),
ADD COLUMN     "state" VARCHAR(100);

-- AlterTable
ALTER TABLE "kyc_profiles" ADD COLUMN     "restrictedAt" TIMESTAMPTZ(6),
ADD COLUMN     "tier" "KycTier" NOT NULL DEFAULT 'TIER_1',
ALTER COLUMN "level" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "kyc_checks" RENAME COLUMN "type" TO "legacyType";

ALTER TABLE "kyc_checks" ADD COLUMN     "failureReason" VARCHAR(500),
ADD COLUMN     "maskedIdentifier" VARCHAR(64),
ADD COLUMN     "provider" VARCHAR(64),
ADD COLUMN     "rawDataExpiresAt" TIMESTAMPTZ(6),
ADD COLUMN     "resultSummary" JSONB,
ADD COLUMN     "reviewerUserId" UUID,
ADD COLUMN     "riskFlags" JSONB,
ADD COLUMN     "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "type" "VerificationType";

UPDATE "kyc_checks"
SET "provider" = 'legacy',
    "type" = CASE UPPER("legacyType")
      WHEN 'BVN' THEN 'BVN'::"VerificationType"
      WHEN 'NIN' THEN 'NIN'::"VerificationType"
      WHEN 'VNIN' THEN 'VNIN'::"VerificationType"
      WHEN 'BANK_ACCOUNT' THEN 'BANK_ACCOUNT'::"VerificationType"
      WHEN 'FACE_MATCH' THEN 'FACE_MATCH'::"VerificationType"
      WHEN 'LIVENESS' THEN 'LIVENESS'::"VerificationType"
      WHEN 'ADDRESS' THEN 'ADDRESS'::"VerificationType"
      ELSE 'MANUAL_REVIEW'::"VerificationType"
    END;

ALTER TABLE "kyc_checks"
ALTER COLUMN "provider" SET NOT NULL,
ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE "kyc_checks" DROP COLUMN "legacyType";

-- AlterTable
ALTER TABLE "financial_accounts" ADD COLUMN     "purpose" "FinancialAccountPurpose";

-- AlterTable
ALTER TABLE "referrals" ADD COLUMN     "campaignId" UUID;

-- AlterTable
ALTER TABLE "referral_rewards" ADD COLUMN     "idempotencyKey" VARCHAR(128),
ADD COLUMN     "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "referral_rewards" SET "idempotencyKey" = 'legacy-referral-reward:' || "id"::text;
ALTER TABLE "referral_rewards" ALTER COLUMN "idempotencyKey" SET NOT NULL;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "templateVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "quietHoursEndMinutes" INTEGER,
ADD COLUMN     "quietHoursStartMinutes" INTEGER,
ADD COLUMN     "timezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Lagos';

-- CreateTable
CREATE TABLE "ajo_contribution_plans" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "contributionUnitMinor" BIGINT NOT NULL,
    "unitQuantity" INTEGER NOT NULL,
    "expectedPerCycleMinor" BIGINT NOT NULL,
    "totalExpectedMinor" BIGINT NOT NULL,
    "actualPaidMinor" BIGINT NOT NULL DEFAULT 0,
    "outstandingMinor" BIGINT NOT NULL,
    "expectedEntitlementMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "lockedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ajo_contribution_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajo_schedule_versions" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "previousVersionId" UUID,
    "reason" "ScheduleVersionReason" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ajo_schedule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_withdrawals" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "penaltyMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "ledgerTransactionId" UUID,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "savings_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_categories" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerCode" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "BillCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "catalogData" JSONB,
    "refreshedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bill_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_billers" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "providerCode" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "BillCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "catalogData" JSONB,
    "refreshedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bill_billers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_products" (
    "id" UUID NOT NULL,
    "billerId" UUID NOT NULL,
    "providerCode" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "BillCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "minimumMinor" BIGINT,
    "maximumMinor" BIGINT,
    "fixedAmountMinor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "catalogData" JSONB,

    CONSTRAINT "bill_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_customer_validations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "billerId" UUID NOT NULL,
    "productId" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "providerReference" VARCHAR(191),
    "customerReferenceDigest" VARCHAR(128) NOT NULL,
    "customerReferenceMasked" VARCHAR(64) NOT NULL,
    "verifiedCustomerName" VARCHAR(200),
    "resultSummary" JSONB,
    "valid" BOOLEAN NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_customer_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payments" (
    "id" UUID NOT NULL,
    "internalReference" VARCHAR(80) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerReference" VARCHAR(191),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "userId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "billerId" UUID NOT NULL,
    "productId" UUID,
    "validationId" UUID,
    "customerReferenceDigest" VARCHAR(128) NOT NULL,
    "customerReferenceMasked" VARCHAR(64) NOT NULL,
    "verifiedCustomerName" VARCHAR(200),
    "amountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "totalDebitMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "BillPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "providerStatus" VARCHAR(80),
    "reconciliationState" "ReconciliationState" NOT NULL DEFAULT 'NOT_REQUIRED',
    "failureCode" VARCHAR(64),
    "failureReason" VARCHAR(500),
    "metadata" JSONB,
    "reserveLedgerTransactionId" UUID,
    "ledgerTransactionId" UUID,
    "releaseLedgerTransactionId" UUID,
    "reversalLedgerTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMPTZ(6),
    "processingAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "failedAt" TIMESTAMPTZ(6),
    "reversedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_attempts" (
    "id" UUID NOT NULL,
    "billPaymentId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "providerReference" VARCHAR(191),
    "status" "BillPaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "requestHash" VARCHAR(128) NOT NULL,
    "responseSummary" JSONB,
    "failureCode" VARCHAR(64),
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "bill_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_provider_events" (
    "id" UUID NOT NULL,
    "billPaymentId" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "providerEventId" VARCHAR(191) NOT NULL,
    "payloadHash" VARCHAR(128) NOT NULL,
    "signatureHash" VARCHAR(128),
    "status" "EventProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "resultSummary" JSONB,
    "failureReason" VARCHAR(500),
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "bill_payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_reversals" (
    "id" UUID NOT NULL,
    "billPaymentId" UUID NOT NULL,
    "providerReference" VARCHAR(191),
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "ledgerTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "bill_payment_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_receipts" (
    "id" UUID NOT NULL,
    "billPaymentId" UUID NOT NULL,
    "receiptNumber" VARCHAR(80) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_app_configurations" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "value" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "public_app_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "contentHash" VARCHAR(128) NOT NULL,
    "invoiceReference" VARCHAR(120),
    "invoiceDate" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_coordinator_applications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "FoodCoordinatorApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "personalDetails" JSONB NOT NULL,
    "businessDetails" JSONB,
    "operatingLocation" JSONB NOT NULL,
    "fulfilmentLocations" JSONB NOT NULL,
    "settlementBankCode" VARCHAR(20),
    "settlementAccountMasked" VARCHAR(32),
    "settlementVerificationRef" VARCHAR(191),
    "identityVerificationRef" VARCHAR(191),
    "riskAssessmentRef" VARCHAR(191),
    "verificationConsentAt" TIMESTAMPTZ(6),
    "identityVerifiedAt" TIMESTAMPTZ(6),
    "bankVerifiedAt" TIMESTAMPTZ(6),
    "riskResult" JSONB,
    "termsAcceptedAt" TIMESTAMPTZ(6),
    "submittedAt" TIMESTAMPTZ(6),
    "approvedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "rejectionReason" VARCHAR(1000),
    "suspensionReason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "food_coordinator_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_coordinator_documents" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "contentHash" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_coordinator_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_coordinator_reviews" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "reviewerUserId" UUID NOT NULL,
    "fromStatus" "FoodCoordinatorApplicationStatus" NOT NULL,
    "toStatus" "FoodCoordinatorApplicationStatus" NOT NULL,
    "notes" VARCHAR(2000),
    "riskResult" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_coordinator_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_campaigns" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ReferralCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "qualifyingProduct" VARCHAR(64) NOT NULL,
    "qualifyingEvent" VARCHAR(100) NOT NULL,
    "minimumTransactionCount" INTEGER NOT NULL DEFAULT 1,
    "minimumAmountMinor" BIGINT,
    "requiredKycTier" "KycTier" NOT NULL DEFAULT 'TIER_1',
    "rewardAmountMinor" BIGINT NOT NULL,
    "rewardCurrency" CHAR(3) NOT NULL,
    "maximumRewards" INTEGER,
    "fraudRestrictions" JSONB NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_qualifications" (
    "id" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "qualifyingEventId" UUID NOT NULL,
    "qualifyingProduct" VARCHAR(64) NOT NULL,
    "qualifyingEvent" VARCHAR(100) NOT NULL,
    "settledAmountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "reversedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "channel" "NotificationChannel" NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerReference" VARCHAR(191),
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "failureCode" VARCHAR(64),
    "failureReason" VARCHAR(500),
    "nextAttemptAt" TIMESTAMPTZ(6),
    "sentAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ajo_contribution_plans_memberId_key" ON "ajo_contribution_plans"("memberId");

-- CreateIndex
CREATE INDEX "ajo_contribution_plans_groupId_lockedAt_idx" ON "ajo_contribution_plans"("groupId", "lockedAt");

-- CreateIndex
CREATE INDEX "ajo_schedule_versions_previousVersionId_idx" ON "ajo_schedule_versions"("previousVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ajo_schedule_versions_groupId_version_key" ON "ajo_schedule_versions"("groupId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "savings_withdrawals_idempotencyKey_key" ON "savings_withdrawals"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "savings_withdrawals_ledgerTransactionId_key" ON "savings_withdrawals"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "savings_withdrawals_goalId_status_requestedAt_idx" ON "savings_withdrawals"("goalId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "bill_categories_status_expiresAt_idx" ON "bill_categories"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "bill_categories_provider_providerCode_key" ON "bill_categories"("provider", "providerCode");

-- CreateIndex
CREATE INDEX "bill_billers_categoryId_status_idx" ON "bill_billers"("categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bill_billers_categoryId_providerCode_key" ON "bill_billers"("categoryId", "providerCode");

-- CreateIndex
CREATE INDEX "bill_products_billerId_status_idx" ON "bill_products"("billerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bill_products_billerId_providerCode_key" ON "bill_products"("billerId", "providerCode");

-- CreateIndex
CREATE INDEX "bill_customer_validations_userId_billerId_expiresAt_idx" ON "bill_customer_validations"("userId", "billerId", "expiresAt");

-- CreateIndex
CREATE INDEX "bill_customer_validations_provider_providerReference_idx" ON "bill_customer_validations"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_internalReference_key" ON "bill_payments"("internalReference");

-- CreateIndex
CREATE INDEX "bill_payments_provider_providerReference_idx" ON "bill_payments"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "bill_payments_userId_status_createdAt_idx" ON "bill_payments"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "bill_payments_walletId_status_createdAt_idx" ON "bill_payments"("walletId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "bill_payments_reconciliationState_updatedAt_idx" ON "bill_payments"("reconciliationState", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_userId_idempotencyKey_key" ON "bill_payments"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "bill_payment_attempts_providerReference_idx" ON "bill_payment_attempts"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_attempts_billPaymentId_attemptNumber_key" ON "bill_payment_attempts"("billPaymentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "bill_payment_provider_events_billPaymentId_receivedAt_idx" ON "bill_payment_provider_events"("billPaymentId", "receivedAt");

-- CreateIndex
CREATE INDEX "bill_payment_provider_events_status_receivedAt_idx" ON "bill_payment_provider_events"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_provider_events_provider_providerEventId_key" ON "bill_payment_provider_events"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_reversals_idempotencyKey_key" ON "bill_payment_reversals"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_reversals_ledgerTransactionId_key" ON "bill_payment_reversals"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "bill_payment_reversals_billPaymentId_createdAt_idx" ON "bill_payment_reversals"("billPaymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_receipts_billPaymentId_key" ON "bill_payment_receipts"("billPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_receipts_receiptNumber_key" ON "bill_payment_receipts"("receiptNumber");

-- CreateIndex
CREATE INDEX "public_app_configurations_key_isActive_effectiveAt_idx" ON "public_app_configurations"("key", "isActive", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "public_app_configurations_key_version_key" ON "public_app_configurations"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_storageKey_key" ON "purchase_invoices"("storageKey");

-- CreateIndex
CREATE INDEX "purchase_invoices_purchaseOrderId_idx" ON "purchase_invoices"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "food_coordinator_applications_userId_status_createdAt_idx" ON "food_coordinator_applications"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "food_coordinator_applications_status_submittedAt_idx" ON "food_coordinator_applications"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "food_coordinator_documents_storageKey_key" ON "food_coordinator_documents"("storageKey");

-- CreateIndex
CREATE INDEX "food_coordinator_documents_applicationId_type_idx" ON "food_coordinator_documents"("applicationId", "type");

-- CreateIndex
CREATE INDEX "food_coordinator_reviews_applicationId_createdAt_idx" ON "food_coordinator_reviews"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "food_coordinator_reviews_reviewerUserId_createdAt_idx" ON "food_coordinator_reviews"("reviewerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "referral_campaigns_status_effectiveAt_expiresAt_idx" ON "referral_campaigns"("status", "effectiveAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "referral_campaigns_code_version_key" ON "referral_campaigns"("code", "version");

-- CreateIndex
CREATE INDEX "referral_qualifications_referralId_occurredAt_idx" ON "referral_qualifications"("referralId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "referral_qualifications_referralId_qualifyingEventId_key" ON "referral_qualifications"("referralId", "qualifyingEventId");

-- CreateIndex
CREATE INDEX "notification_templates_key_isActive_idx" ON "notification_templates"("key", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_version_channel_key" ON "notification_templates"("key", "version", "channel");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_provider_providerReference_idx" ON "notification_deliveries"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_attemptNumber_key" ON "notification_deliveries"("notificationId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "swap_requests_feeAssessmentId_key" ON "swap_requests"("feeAssessmentId");

-- CreateIndex
CREATE INDEX "ajo_groups_contributionMode_status_idx" ON "ajo_groups"("contributionMode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payout_schedules_cycleId_slotId_scheduleVersion_key" ON "payout_schedules"("cycleId", "slotId", "scheduleVersion");

-- CreateIndex
CREATE UNIQUE INDEX "payout_schedules_groupId_slotId_scheduleVersion_key" ON "payout_schedules"("groupId", "slotId", "scheduleVersion");

-- CreateIndex
CREATE INDEX "fee_definitions_code_isActive_effectiveAt_idx" ON "fee_definitions"("code", "isActive", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "fee_definitions_code_version_key" ON "fee_definitions"("code", "version");

-- CreateIndex
CREATE INDEX "purchase_orders_foodAjoGroupId_status_idx" ON "purchase_orders"("foodAjoGroupId", "status");

-- CreateIndex
CREATE INDEX "kyc_checks_kycProfileId_type_status_idx" ON "kyc_checks"("kycProfileId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_checks_provider_providerRef_key" ON "kyc_checks"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "financial_accounts_purpose_currency_isActive_idx" ON "financial_accounts"("purpose", "currency", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_idempotencyKey_key" ON "referral_rewards"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_feeAssessmentId_fkey" FOREIGN KEY ("feeAssessmentId") REFERENCES "fee_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajo_contribution_plans" ADD CONSTRAINT "ajo_contribution_plans_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajo_contribution_plans" ADD CONSTRAINT "ajo_contribution_plans_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajo_schedule_versions" ADD CONSTRAINT "ajo_schedule_versions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajo_schedule_versions" ADD CONSTRAINT "ajo_schedule_versions_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "ajo_schedule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_withdrawals" ADD CONSTRAINT "savings_withdrawals_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "savings_goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_billers" ADD CONSTRAINT "bill_billers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "bill_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_products" ADD CONSTRAINT "bill_products_billerId_fkey" FOREIGN KEY ("billerId") REFERENCES "bill_billers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_billerId_fkey" FOREIGN KEY ("billerId") REFERENCES "bill_billers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_productId_fkey" FOREIGN KEY ("productId") REFERENCES "bill_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_attempts" ADD CONSTRAINT "bill_payment_attempts_billPaymentId_fkey" FOREIGN KEY ("billPaymentId") REFERENCES "bill_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_provider_events" ADD CONSTRAINT "bill_payment_provider_events_billPaymentId_fkey" FOREIGN KEY ("billPaymentId") REFERENCES "bill_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_reversals" ADD CONSTRAINT "bill_payment_reversals_billPaymentId_fkey" FOREIGN KEY ("billPaymentId") REFERENCES "bill_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_receipts" ADD CONSTRAINT "bill_payment_receipts_billPaymentId_fkey" FOREIGN KEY ("billPaymentId") REFERENCES "bill_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_foodAjoGroupId_fkey" FOREIGN KEY ("foodAjoGroupId") REFERENCES "food_ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_coordinator_documents" ADD CONSTRAINT "food_coordinator_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "food_coordinator_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_coordinator_reviews" ADD CONSTRAINT "food_coordinator_reviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "food_coordinator_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "referral_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_qualifications" ADD CONSTRAINT "referral_qualifications_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial and capacity invariants not expressible in Prisma's schema language.
ALTER TABLE "ajo_groups" ADD CONSTRAINT "ajo_groups_capacity_check"
CHECK (
  "maxMembers" BETWEEN 2 AND 1000
  AND "maxSlots" BETWEEN 2 AND 1000
  AND "minSlotsPerMember" >= 1
  AND "maxSlotsPerMember" >= "minSlotsPerMember"
  AND "maxSlotsPerMember" <= "maxSlots"
  AND "baseContributionMinor" > 0
  AND ("contributionUnitMinor" IS NULL OR "contributionUnitMinor" > 0)
  AND "contributionOpenOffsetMinutes" >= 0
  AND "contributionCloseOffsetMinutes" >= 0
  AND "gracePeriodMinutes" >= 0
  AND "lateThresholdMinutes" >= 0
  AND "payoutEligibilityCutoffMinutes" >= 0
  AND "payoutOffsetMinutes" >= 0
  AND "payoutProcessingWindowMinutes" > 0
);

ALTER TABLE "ajo_contribution_plans" ADD CONSTRAINT "ajo_contribution_plans_amount_check"
CHECK (
  "contributionUnitMinor" > 0
  AND "unitQuantity" > 0
  AND "expectedPerCycleMinor" > 0
  AND "totalExpectedMinor" >= 0
  AND "actualPaidMinor" >= 0
  AND "outstandingMinor" >= 0
  AND "expectedEntitlementMinor" > 0
);

ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_amount_check"
CHECK (
  "amountMinor" > 0
  AND "feeMinor" >= 0
  AND "totalDebitMinor" = "amountMinor" + "feeMinor"
);

ALTER TABLE "bill_payment_reversals" ADD CONSTRAINT "bill_payment_reversals_amount_check"
CHECK ("amountMinor" > 0);

ALTER TABLE "food_ajo_groups" ADD CONSTRAINT "food_ajo_groups_capacity_check"
CHECK ("enrolmentCapacity" > 0 AND "contributionMinor" > 0);

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_quiet_hours_check"
CHECK (
  ("quietHoursStartMinutes" IS NULL OR "quietHoursStartMinutes" BETWEEN 0 AND 1439)
  AND ("quietHoursEndMinutes" IS NULL OR "quietHoursEndMinutes" BETWEEN 0 AND 1439)
);

CREATE UNIQUE INDEX "food_coordinator_applications_one_active_per_user_key"
ON "food_coordinator_applications"("userId")
WHERE "status" NOT IN ('REJECTED', 'REVOKED', 'EXPIRED');
