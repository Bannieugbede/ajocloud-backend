CREATE TYPE "AccountVerificationChannel" AS ENUM ('PHONE', 'EMAIL');
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'PRIVACY');

CREATE TABLE "account_verification_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "AccountVerificationChannel" NOT NULL,
    "codeHash" VARCHAR(128) NOT NULL,
    "destinationMasked" VARCHAR(191) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "resendAvailableAt" TIMESTAMPTZ(6) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMPTZ(6),
    "invalidatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_verification_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_verification_challenges_attempts_check" CHECK ("attemptCount" >= 0 AND "attemptCount" <= "maxAttempts"),
    CONSTRAINT "account_verification_challenges_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" INET,
    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_verification_challenges_userId_channel_createdAt_idx"
ON "account_verification_challenges"("userId", "channel", "createdAt");
CREATE INDEX "account_verification_challenges_expiresAt_idx"
ON "account_verification_challenges"("expiresAt");
CREATE UNIQUE INDEX "user_consents_userId_type_version_key"
ON "user_consents"("userId", "type", "version");
CREATE INDEX "user_consents_type_version_acceptedAt_idx"
ON "user_consents"("type", "version", "acceptedAt");

ALTER TABLE "account_verification_challenges"
ADD CONSTRAINT "account_verification_challenges_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_consents"
ADD CONSTRAINT "user_consents_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
