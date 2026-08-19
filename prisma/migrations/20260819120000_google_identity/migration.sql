-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE');

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "providerUserId" VARCHAR(191) NOT NULL,
    "email" VARCHAR(320),
    "linkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_providerUserId_key"
  ON "user_identities"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_userId_provider_key"
  ON "user_identities"("userId", "provider");

-- CreateIndex
CREATE INDEX "user_identities_userId_idx" ON "user_identities"("userId");

-- AddForeignKey
ALTER TABLE "user_identities"
  ADD CONSTRAINT "user_identities_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
