-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('PASSWORD');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'COMPROMISED');

-- CreateEnum
CREATE TYPE "OrganisationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrganisationMemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LEFT');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED', 'REQUIRES_REVIEW', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KycCheckStatus" AS ENUM ('PENDING', 'PROCESSING', 'PASSED', 'FAILED', 'ERROR');

-- CreateEnum
CREATE TYPE "ComplianceReviewStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LedgerEntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'REVIEWING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FeeCalculationType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "FeeAssessmentStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED', 'REVERSED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EventProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "FoodAjoStatus" AS ENUM ('DRAFT', 'OPEN', 'ACTIVE', 'COMPLETED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FoodSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FoodDistributionStatus" AS ENUM ('PLANNED', 'READY', 'DISTRIBUTING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SavingsGoalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SavingsScheduleStatus" AS ENUM ('PENDING', 'DUE', 'PAID', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SavingsWithdrawalRuleType" AS ENUM ('FLEXIBLE', 'LOCKED_UNTIL_DATE', 'TARGET_REACHED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AjoGroupStatus" AS ENUM ('DRAFT', 'OPEN', 'LOCKED', 'ACTIVE', 'COMPLETED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContributionFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AjoMemberRole" AS ENUM ('GROUP_ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "AjoMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT', 'REMOVED');

-- CreateEnum
CREATE TYPE "AjoSlotStatus" AS ENUM ('RESERVED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AjoCycleStatus" AS ENUM ('PENDING', 'OPEN', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContributionScheduleStatus" AS ENUM ('PENDING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutScheduleStatus" AS ENUM ('PENDING', 'READY', 'PROCESSING', 'PAID', 'HELD', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "SwapRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SwapApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PenaltyCalculationType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "PenaltyRecordStatus" AS ENUM ('PENDING', 'ASSESSED', 'PAID', 'WAIVED', 'REVERSED');

-- CreateEnum
CREATE TYPE "GroupInvitationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "GroupReferralCodeStatus" AS ENUM ('ACTIVE', 'DISABLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "swap_requests" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "requestedByMemberId" UUID NOT NULL,
    "fromSlotId" UUID NOT NULL,
    "toSlotId" UUID NOT NULL,
    "status" "SwapRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(500),
    "scheduleVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "decidedAt" TIMESTAMPTZ(6),
    "executedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swap_approvals" (
    "id" UUID NOT NULL,
    "swapRequestId" UUID NOT NULL,
    "approverMemberId" UUID NOT NULL,
    "decision" "SwapApprovalDecision" NOT NULL,
    "reason" VARCHAR(500),
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swap_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_invitations" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "createdByMemberId" UUID NOT NULL,
    "tokenDigest" VARCHAR(128) NOT NULL,
    "status" "GroupInvitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "group_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_referral_codes" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "ownerMemberId" UUID,
    "codeDigest" VARCHAR(128) NOT NULL,
    "status" "GroupReferralCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "group_referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajo_groups" (
    "id" UUID NOT NULL,
    "organisationId" UUID,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "status" "AjoGroupStatus" NOT NULL DEFAULT 'DRAFT',
    "contributionFrequency" "ContributionFrequency" NOT NULL,
    "baseContributionMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "maxSlots" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "scheduleVersion" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMPTZ(6),
    "activatedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "suspendedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ajo_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajo_group_members" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "AjoMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "AjoMemberStatus" NOT NULL DEFAULT 'INVITED',
    "joinedAt" TIMESTAMPTZ(6),
    "suspendedAt" TIMESTAMPTZ(6),
    "leftAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ajo_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajo_slots" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "AjoSlotStatus" NOT NULL DEFAULT 'RESERVED',
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ajo_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajo_cycles" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "AjoCycleStatus" NOT NULL DEFAULT 'PENDING',
    "contributionDueAt" TIMESTAMPTZ(6) NOT NULL,
    "payoutDueAt" TIMESTAMPTZ(6) NOT NULL,
    "openedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ajo_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_schedules" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "amountDueMinor" BIGINT NOT NULL,
    "amountPaidMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "ContributionScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "scheduleVersion" INTEGER NOT NULL,
    "immutableAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contribution_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_schedules" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "amountDueMinor" BIGINT NOT NULL,
    "amountPaidMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "PayoutScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "scheduleVersion" INTEGER NOT NULL,
    "immutableAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payout_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ContributionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "externalReference" VARCHAR(191),
    "ledgerTransactionId" UUID,
    "failureCode" VARCHAR(64),
    "failureReason" VARCHAR(500),
    "processedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "externalReference" VARCHAR(191),
    "ledgerTransactionId" UUID,
    "failureCode" VARCHAR(64),
    "failureReason" VARCHAR(500),
    "processedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalty_rules" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "calculationType" "PenaltyCalculationType" NOT NULL,
    "amountMinor" BIGINT,
    "basisPoints" INTEGER,
    "currency" CHAR(3),
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "penalty_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalty_records" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "contributionScheduleId" UUID,
    "assessedByMemberId" UUID,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PenaltyRecordStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(500) NOT NULL,
    "assessedAt" TIMESTAMPTZ(6),
    "paidAt" TIMESTAMPTZ(6),
    "waivedAt" TIMESTAMPTZ(6),
    "waivedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "penalty_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_goals" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "targetMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "SavingsGoalStatus" NOT NULL DEFAULT 'DRAFT',
    "targetDate" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_schedules" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "SavingsScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_contributions" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "ledgerTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_withdrawal_rules" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "type" "SavingsWithdrawalRuleType" NOT NULL,
    "unlocksAt" TIMESTAMPTZ(6),
    "penaltyBps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_withdrawal_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_definitions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "calculationType" "FeeCalculationType" NOT NULL,
    "amountMinor" BIGINT,
    "basisPoints" INTEGER,
    "currency" CHAR(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fee_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_assessments" (
    "id" UUID NOT NULL,
    "feeDefinitionId" UUID NOT NULL,
    "subjectType" VARCHAR(64) NOT NULL,
    "subjectId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "FeeAssessmentStatus" NOT NULL DEFAULT 'PENDING',
    "ledgerTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_ajo_groups" (
    "id" UUID NOT NULL,
    "coordinatorUserId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "FoodAjoStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "contributionMinor" BIGINT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "food_ajo_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_packages" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "food_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_package_items" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,

    CONSTRAINT "food_package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_subscriptions" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "FoodSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "food_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "contactEmail" VARCHAR(320),
    "contactPhone" VARCHAR(32),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "internalReference" VARCHAR(80) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "totalMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "contentHash" VARCHAR(128) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_distributions" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "status" "FoodDistributionStatus" NOT NULL DEFAULT 'PLANNED',
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_distribution_items" (
    "id" UUID NOT NULL,
    "distributionId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "food_distribution_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_confirmations" (
    "id" UUID NOT NULL,
    "distributionItemId" UUID NOT NULL,
    "confirmedByUserId" UUID NOT NULL,
    "confirmationHash" VARCHAR(128) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(32),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "phoneVerifiedAt" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "suspendedAt" TIMESTAMPTZ(6),
    "deactivatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "avatarUrl" VARCHAR(2048),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Lagos',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en-NG',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "CredentialType" NOT NULL DEFAULT 'PASSWORD',
    "passwordHash" VARCHAR(255) NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" VARCHAR(191) NOT NULL,
    "name" VARCHAR(120),
    "platform" VARCHAR(64),
    "trustedAt" TIMESTAMPTZ(6),
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentTokenHash" VARCHAR(128) NOT NULL,
    "ipAddress" INET,
    "userAgent" VARCHAR(500),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "lastRotatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "revokeReason" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "replacedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "level" INTEGER NOT NULL DEFAULT 0,
    "providerRef" VARCHAR(191),
    "submittedAt" TIMESTAMPTZ(6),
    "verifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_checks" (
    "id" UUID NOT NULL,
    "kycProfileId" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "status" "KycCheckStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" VARCHAR(191),
    "resultCode" VARCHAR(64),
    "checkedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
    "id" UUID NOT NULL,
    "kycProfileId" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "contentHash" VARCHAR(128) NOT NULL,
    "expiresAt" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_provider_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerEventId" VARCHAR(191) NOT NULL,
    "payloadHash" VARCHAR(128) NOT NULL,
    "status" "EventProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "verification_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_coordinator_profiles" (
    "id" UUID NOT NULL,
    "kycProfileId" UUID NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_coordinator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_reviews" (
    "id" UUID NOT NULL,
    "kycProfileId" UUID NOT NULL,
    "reviewerId" UUID,
    "status" "ComplianceReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reason" VARCHAR(1000),
    "decidedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "walletId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reversalOfId" UUID,
    "initiatedByUserId" UUID,
    "correlationId" VARCHAR(128),
    "postedAt" TIMESTAMPTZ(6),
    "reversedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "direction" "LedgerEntryDirection" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrerUserId" UUID NOT NULL,
    "referredUserId" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "qualifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "ledgerTransactionId" UUID,
    "awardedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template" VARCHAR(100) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "dedupeKey" VARCHAR(191),
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "topic" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "subjectType" VARCHAR(64) NOT NULL,
    "subjectId" UUID NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "summary" VARCHAR(1000) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "subjectType" VARCHAR(80) NOT NULL,
    "subjectId" UUID,
    "organisationId" UUID,
    "groupId" UUID,
    "requestId" VARCHAR(128),
    "ipAddress" INET,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "type" VARCHAR(100) NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "fingerprint" VARCHAR(191),
    "metadata" JSONB,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregateType" VARCHAR(80) NOT NULL,
    "aggregateId" UUID NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "correlationId" VARCHAR(128),
    "status" "EventProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_events" (
    "id" UUID NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "eventId" VARCHAR(191) NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "payloadHash" VARCHAR(128) NOT NULL,
    "correlationId" VARCHAR(128),
    "status" "EventProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "status" "OrganisationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_members" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "branchId" UUID,
    "userId" UUID NOT NULL,
    "status" "OrganisationMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(6),

    CONSTRAINT "organisation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "walletId" UUID,
    "internalReference" VARCHAR(80) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerReference" VARCHAR(191),
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "ledgerTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "providerReference" VARCHAR(191),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerEventId" VARCHAR(191) NOT NULL,
    "payloadHash" VARCHAR(128) NOT NULL,
    "signatureHash" VARCHAR(128),
    "status" "EventProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" VARCHAR(500),
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "internalReference" VARCHAR(80) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "providerReference" VARCHAR(191),
    "ledgerTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "sourceWalletId" UUID NOT NULL,
    "destinationWalletId" UUID NOT NULL,
    "internalReference" VARCHAR(80) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "ledgerTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "lockedUntil" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_records" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "externalReference" VARCHAR(191) NOT NULL,
    "internalReference" VARCHAR(191),
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_records" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerReference" VARCHAR(191) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "settledAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "organisationId" UUID,
    "groupId" UUID,
    "grantedById" UUID,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swap_requests_groupId_status_createdAt_idx" ON "swap_requests"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "swap_requests_requestedByMemberId_status_idx" ON "swap_requests"("requestedByMemberId", "status");

-- CreateIndex
CREATE INDEX "swap_requests_fromSlotId_idx" ON "swap_requests"("fromSlotId");

-- CreateIndex
CREATE INDEX "swap_requests_toSlotId_idx" ON "swap_requests"("toSlotId");

-- CreateIndex
CREATE INDEX "swap_approvals_approverMemberId_decidedAt_idx" ON "swap_approvals"("approverMemberId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "swap_approvals_swapRequestId_approverMemberId_key" ON "swap_approvals"("swapRequestId", "approverMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "group_invitations_tokenDigest_key" ON "group_invitations"("tokenDigest");

-- CreateIndex
CREATE INDEX "group_invitations_groupId_status_expiresAt_idx" ON "group_invitations"("groupId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "group_referral_codes_codeDigest_key" ON "group_referral_codes"("codeDigest");

-- CreateIndex
CREATE INDEX "group_referral_codes_groupId_status_expiresAt_idx" ON "group_referral_codes"("groupId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "group_referral_codes_ownerMemberId_idx" ON "group_referral_codes"("ownerMemberId");

-- CreateIndex
CREATE INDEX "ajo_groups_organisationId_status_idx" ON "ajo_groups"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ajo_groups_createdByUserId_idx" ON "ajo_groups"("createdByUserId");

-- CreateIndex
CREATE INDEX "ajo_groups_status_startDate_idx" ON "ajo_groups"("status", "startDate");

-- CreateIndex
CREATE INDEX "ajo_group_members_userId_status_idx" ON "ajo_group_members"("userId", "status");

-- CreateIndex
CREATE INDEX "ajo_group_members_groupId_role_status_idx" ON "ajo_group_members"("groupId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ajo_group_members_groupId_userId_key" ON "ajo_group_members"("groupId", "userId");

-- CreateIndex
CREATE INDEX "ajo_slots_memberId_status_idx" ON "ajo_slots"("memberId", "status");

-- CreateIndex
CREATE INDEX "ajo_slots_groupId_status_idx" ON "ajo_slots"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ajo_slots_groupId_position_key" ON "ajo_slots"("groupId", "position");

-- CreateIndex
CREATE INDEX "ajo_cycles_groupId_status_contributionDueAt_idx" ON "ajo_cycles"("groupId", "status", "contributionDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ajo_cycles_groupId_sequence_key" ON "ajo_cycles"("groupId", "sequence");

-- CreateIndex
CREATE INDEX "contribution_schedules_groupId_status_dueAt_idx" ON "contribution_schedules"("groupId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "contribution_schedules_slotId_status_idx" ON "contribution_schedules"("slotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_schedules_cycleId_slotId_key" ON "contribution_schedules"("cycleId", "slotId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_schedules_cycleId_key" ON "payout_schedules"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_schedules_slotId_key" ON "payout_schedules"("slotId");

-- CreateIndex
CREATE INDEX "payout_schedules_groupId_status_dueAt_idx" ON "payout_schedules"("groupId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_idempotencyKey_key" ON "contributions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "contributions_scheduleId_status_idx" ON "contributions"("scheduleId", "status");

-- CreateIndex
CREATE INDEX "contributions_memberId_createdAt_idx" ON "contributions"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "contributions_groupId_status_createdAt_idx" ON "contributions"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "contributions_externalReference_idx" ON "contributions"("externalReference");

-- CreateIndex
CREATE INDEX "contributions_ledgerTransactionId_idx" ON "contributions"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_idempotencyKey_key" ON "payouts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payouts_scheduleId_status_idx" ON "payouts"("scheduleId", "status");

-- CreateIndex
CREATE INDEX "payouts_memberId_createdAt_idx" ON "payouts"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "payouts_groupId_status_createdAt_idx" ON "payouts"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payouts_externalReference_idx" ON "payouts"("externalReference");

-- CreateIndex
CREATE INDEX "payouts_ledgerTransactionId_idx" ON "payouts"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "penalty_rules_groupId_isActive_idx" ON "penalty_rules"("groupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "penalty_rules_groupId_name_key" ON "penalty_rules"("groupId", "name");

-- CreateIndex
CREATE INDEX "penalty_records_groupId_status_createdAt_idx" ON "penalty_records"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "penalty_records_memberId_status_idx" ON "penalty_records"("memberId", "status");

-- CreateIndex
CREATE INDEX "penalty_records_contributionScheduleId_idx" ON "penalty_records"("contributionScheduleId");

-- CreateIndex
CREATE INDEX "savings_goals_userId_status_idx" ON "savings_goals"("userId", "status");

-- CreateIndex
CREATE INDEX "savings_schedules_goalId_status_dueAt_idx" ON "savings_schedules"("goalId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "savings_contributions_idempotencyKey_key" ON "savings_contributions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "savings_contributions_ledgerTransactionId_key" ON "savings_contributions"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "savings_contributions_goalId_status_idx" ON "savings_contributions"("goalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "savings_withdrawal_rules_goalId_key" ON "savings_withdrawal_rules"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_definitions_code_key" ON "fee_definitions"("code");

-- CreateIndex
CREATE INDEX "fee_assessments_subjectType_subjectId_idx" ON "fee_assessments"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "food_ajo_groups_coordinatorUserId_status_idx" ON "food_ajo_groups"("coordinatorUserId", "status");

-- CreateIndex
CREATE INDEX "food_packages_groupId_isActive_idx" ON "food_packages"("groupId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "food_subscriptions_groupId_userId_packageId_key" ON "food_subscriptions"("groupId", "userId", "packageId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_internalReference_key" ON "purchase_orders"("internalReference");

-- CreateIndex
CREATE INDEX "purchase_orders_vendorId_status_idx" ON "purchase_orders"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_storageKey_key" ON "purchase_receipts"("storageKey");

-- CreateIndex
CREATE INDEX "food_distributions_groupId_scheduledAt_idx" ON "food_distributions"("groupId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "food_distribution_items_distributionId_subscriptionId_key" ON "food_distribution_items"("distributionId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_confirmations_distributionItemId_key" ON "distribution_confirmations"("distributionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_status_createdAt_idx" ON "users"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_userId_key" ON "user_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_userId_fingerprint_key" ON "devices"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "sessions_userId_status_idx" ON "sessions"("userId", "status");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_sessionId_expiresAt_idx" ON "refresh_tokens"("sessionId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_profiles_userId_key" ON "kyc_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_profiles_providerRef_key" ON "kyc_profiles"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_checks_providerRef_key" ON "kyc_checks"("providerRef");

-- CreateIndex
CREATE INDEX "kyc_checks_kycProfileId_status_idx" ON "kyc_checks"("kycProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "verification_documents_storageKey_key" ON "verification_documents"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "verification_provider_events_provider_providerEventId_key" ON "verification_provider_events"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "food_coordinator_profiles_kycProfileId_key" ON "food_coordinator_profiles"("kycProfileId");

-- CreateIndex
CREATE INDEX "compliance_reviews_status_createdAt_idx" ON "compliance_reviews"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_code_key" ON "financial_accounts"("code");

-- CreateIndex
CREATE INDEX "financial_accounts_type_currency_isActive_idx" ON "financial_accounts"("type", "currency", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reference_key" ON "ledger_transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotencyKey_key" ON "ledger_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reversalOfId_key" ON "ledger_transactions"("reversalOfId");

-- CreateIndex
CREATE INDEX "ledger_transactions_status_createdAt_idx" ON "ledger_transactions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_transactions_correlationId_idx" ON "ledger_transactions"("correlationId");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_createdAt_idx" ON "ledger_entries"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_transactionId_sequence_key" ON "ledger_entries"("transactionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referredUserId_key" ON "referrals"("referredUserId");

-- CreateIndex
CREATE INDEX "referrals_referrerUserId_status_idx" ON "referrals"("referrerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_ledgerTransactionId_key" ON "referral_rewards"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_userId_status_createdAt_idx" ON "notifications"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_channel_topic_key" ON "notification_preferences"("userId", "channel", "topic");

-- CreateIndex
CREATE INDEX "disputes_status_createdAt_idx" ON "disputes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "disputes_subjectType_subjectId_idx" ON "disputes"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "dispute_messages_disputeId_createdAt_idx" ON "dispute_messages"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_subjectType_subjectId_createdAt_idx" ON "audit_logs"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_groupId_createdAt_idx" ON "audit_logs"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "risk_events_severity_resolvedAt_createdAt_idx" ON "risk_events"("severity", "resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_status_availableAt_idx" ON "outbox_events"("status", "availableAt");

-- CreateIndex
CREATE INDEX "inbox_events_status_createdAt_idx" ON "inbox_events"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_events_source_eventId_key" ON "inbox_events"("source", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organisationId_code_key" ON "branches"("organisationId", "code");

-- CreateIndex
CREATE INDEX "organisation_members_userId_status_idx" ON "organisation_members"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_members_organisationId_userId_key" ON "organisation_members"("organisationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_internalReference_key" ON "payments"("internalReference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerReference_key" ON "payments"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_ledgerTransactionId_key" ON "payments"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "payments_userId_status_createdAt_idx" ON "payments"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_attempts_providerReference_idx" ON "payment_attempts"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_paymentId_attemptNumber_key" ON "payment_attempts"("paymentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "payment_webhook_events_status_receivedAt_idx" ON "payment_webhook_events"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_providerEventId_key" ON "payment_webhook_events"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_internalReference_key" ON "withdrawals"("internalReference");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_idempotencyKey_key" ON "withdrawals"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_providerReference_key" ON "withdrawals"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_ledgerTransactionId_key" ON "withdrawals"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "withdrawals_userId_status_createdAt_idx" ON "withdrawals"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_internalReference_key" ON "transfers"("internalReference");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_idempotencyKey_key" ON "transfers"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_ledgerTransactionId_key" ON "transfers"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "transfers_sourceWalletId_createdAt_idx" ON "transfers"("sourceWalletId", "createdAt");

-- CreateIndex
CREATE INDEX "transfers_destinationWalletId_createdAt_idx" ON "transfers"("destinationWalletId", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "reconciliation_records_matched_createdAt_idx" ON "reconciliation_records"("matched", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_records_provider_externalReference_key" ON "reconciliation_records"("provider", "externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_records_provider_providerReference_key" ON "settlement_records"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "user_roles_userId_organisationId_groupId_idx" ON "user_roles"("userId", "organisationId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_organisationId_groupId_key" ON "user_roles"("userId", "roleId", "organisationId", "groupId");

-- CreateIndex
CREATE INDEX "wallets_status_idx" ON "wallets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_currency_key" ON "wallets"("userId", "currency");

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_requestedByMemberId_fkey" FOREIGN KEY ("requestedByMemberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_fromSlotId_fkey" FOREIGN KEY ("fromSlotId") REFERENCES "ajo_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_toSlotId_fkey" FOREIGN KEY ("toSlotId") REFERENCES "ajo_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_approvals" ADD CONSTRAINT "swap_approvals_swapRequestId_fkey" FOREIGN KEY ("swapRequestId") REFERENCES "swap_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_approvals" ADD CONSTRAINT "swap_approvals_approverMemberId_fkey" FOREIGN KEY ("approverMemberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_referral_codes" ADD CONSTRAINT "group_referral_codes_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_referral_codes" ADD CONSTRAINT "group_referral_codes_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajo_group_members" ADD CONSTRAINT "ajo_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajo_slots" ADD CONSTRAINT "ajo_slots_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajo_slots" ADD CONSTRAINT "ajo_slots_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajo_cycles" ADD CONSTRAINT "ajo_cycles_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_schedules" ADD CONSTRAINT "contribution_schedules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_schedules" ADD CONSTRAINT "contribution_schedules_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ajo_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_schedules" ADD CONSTRAINT "contribution_schedules_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ajo_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_schedules" ADD CONSTRAINT "payout_schedules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_schedules" ADD CONSTRAINT "payout_schedules_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ajo_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_schedules" ADD CONSTRAINT "payout_schedules_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ajo_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "contribution_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ajo_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "payout_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ajo_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_rules" ADD CONSTRAINT "penalty_rules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_records" ADD CONSTRAINT "penalty_records_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_records" ADD CONSTRAINT "penalty_records_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "penalty_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_records" ADD CONSTRAINT "penalty_records_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_records" ADD CONSTRAINT "penalty_records_assessedByMemberId_fkey" FOREIGN KEY ("assessedByMemberId") REFERENCES "ajo_group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_records" ADD CONSTRAINT "penalty_records_contributionScheduleId_fkey" FOREIGN KEY ("contributionScheduleId") REFERENCES "contribution_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_schedules" ADD CONSTRAINT "savings_schedules_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "savings_goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_contributions" ADD CONSTRAINT "savings_contributions_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "savings_goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_withdrawal_rules" ADD CONSTRAINT "savings_withdrawal_rules_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "savings_goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_assessments" ADD CONSTRAINT "fee_assessments_feeDefinitionId_fkey" FOREIGN KEY ("feeDefinitionId") REFERENCES "fee_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_packages" ADD CONSTRAINT "food_packages_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "food_ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_package_items" ADD CONSTRAINT "food_package_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "food_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscriptions" ADD CONSTRAINT "food_subscriptions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "food_ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscriptions" ADD CONSTRAINT "food_subscriptions_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "food_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_distributions" ADD CONSTRAINT "food_distributions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "food_ajo_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_distribution_items" ADD CONSTRAINT "food_distribution_items_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "food_distributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_confirmations" ADD CONSTRAINT "distribution_confirmations_distributionItemId_fkey" FOREIGN KEY ("distributionItemId") REFERENCES "food_distribution_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_kycProfileId_fkey" FOREIGN KEY ("kycProfileId") REFERENCES "kyc_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_kycProfileId_fkey" FOREIGN KEY ("kycProfileId") REFERENCES "kyc_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_coordinator_profiles" ADD CONSTRAINT "food_coordinator_profiles_kycProfileId_fkey" FOREIGN KEY ("kycProfileId") REFERENCES "kyc_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_kycProfileId_fkey" FOREIGN KEY ("kycProfileId") REFERENCES "kyc_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_members" ADD CONSTRAINT "organisation_members_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_members" ADD CONSTRAINT "organisation_members_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_members" ADD CONSTRAINT "organisation_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
