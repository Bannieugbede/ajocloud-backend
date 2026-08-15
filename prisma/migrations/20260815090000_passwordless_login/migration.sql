-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('ACCOUNT_VERIFICATION', 'LOGIN');

-- AlterTable
ALTER TABLE "account_verification_challenges"
  ADD COLUMN "purpose" "VerificationPurpose" NOT NULL DEFAULT 'ACCOUNT_VERIFICATION';

-- CreateIndex
CREATE INDEX "account_verification_challenges_userId_purpose_createdAt_idx"
  ON "account_verification_challenges"("userId", "purpose", "createdAt");
