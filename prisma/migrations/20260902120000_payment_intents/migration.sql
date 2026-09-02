-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('REQUIRES_CONFIRMATION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentTargetType" AS ENUM ('AKAWO_POOL_DUE', 'AJO_CONTRIBUTION', 'FOOD_SUBSCRIPTION', 'WALLET_TOPUP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('WALLET', 'TRANSFER', 'CARD');

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "walletId" UUID,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'REQUIRES_CONFIRMATION',
    "targetType" "PaymentTargetType" NOT NULL,
    "targetId" UUID,
    "amountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "PaymentMethod",
    "providerReference" VARCHAR(191),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "ledgerTransactionId" UUID,
    "failureReason" VARCHAR(500),
    "confirmedAt" TIMESTAMPTZ(6),
    "settledAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_providerReference_key" ON "payment_intents"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_ledgerTransactionId_key" ON "payment_intents"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "payment_intents_userId_status_createdAt_idx" ON "payment_intents"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_intents_targetType_targetId_idx" ON "payment_intents"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_userId_idempotencyKey_key" ON "payment_intents"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

