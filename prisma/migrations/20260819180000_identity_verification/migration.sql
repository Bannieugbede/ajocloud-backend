-- Identity verification for Tier 2 onboarding (ADR-004).
-- Raw BVN/NIN is never stored: only masked values and results are persisted.

-- Consent for sending an identity number to the verification provider.
ALTER TYPE "ConsentType" ADD VALUE 'IDENTITY_VERIFICATION';

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- Tier 2 personal details.
ALTER TABLE "user_profiles"
  ADD COLUMN "gender" "Gender",
  ADD COLUMN "addressLine" VARCHAR(200),
  ADD COLUMN "city" VARCHAR(100),
  ADD COLUMN "occupation" VARCHAR(120);

-- Linked bank accounts. The account number itself is stored masked plus an
-- HMAC digest, so the full number cannot be recovered from a database copy.
CREATE TABLE "linked_bank_accounts" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "bankCode" VARCHAR(16) NOT NULL,
  "bankName" VARCHAR(120) NOT NULL,
  "accountMasked" VARCHAR(32) NOT NULL,
  "accountDigest" VARCHAR(128) NOT NULL,
  "accountName" VARCHAR(200) NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "providerRef" VARCHAR(191),
  "verifiedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "linked_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "linked_bank_accounts_userId_accountDigest_key"
  ON "linked_bank_accounts" ("userId", "accountDigest");

CREATE INDEX "linked_bank_accounts_userId_idx" ON "linked_bank_accounts" ("userId");

ALTER TABLE "linked_bank_accounts"
  ADD CONSTRAINT "linked_bank_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
