-- AlterEnum
ALTER TYPE "FeeCalculationType" ADD VALUE 'TIERED';

-- AlterTable
ALTER TABLE "fee_definitions" ADD COLUMN "providerRateBasisPoints" INTEGER,
ADD COLUMN "providerFlatMinor" BIGINT;

-- CreateTable
CREATE TABLE "fee_tiers" (
    "id" UUID NOT NULL,
    "feeDefinitionId" UUID NOT NULL,
    "fromMinor" BIGINT NOT NULL,
    "toMinor" BIGINT,
    "amountMinor" BIGINT NOT NULL,

    CONSTRAINT "fee_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_tiers_feeDefinitionId_fromMinor_key" ON "fee_tiers"("feeDefinitionId", "fromMinor");

-- CreateIndex
CREATE INDEX "fee_tiers_feeDefinitionId_fromMinor_idx" ON "fee_tiers"("feeDefinitionId", "fromMinor");

-- AddForeignKey
ALTER TABLE "fee_tiers" ADD CONSTRAINT "fee_tiers_feeDefinitionId_fkey" FOREIGN KEY ("feeDefinitionId") REFERENCES "fee_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
