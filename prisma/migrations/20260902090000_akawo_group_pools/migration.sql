-- CreateEnum
CREATE TYPE "AkawoPoolStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AkawoPoolMemberStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "AkawoDueStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'WAIVED');

-- CreateTable
CREATE TABLE "akawo_pools" (
    "id" UUID NOT NULL,
    "organiserUserId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "purpose" VARCHAR(500),
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "AkawoPoolStatus" NOT NULL DEFAULT 'DRAFT',
    "joinCodeDigest" VARCHAR(128) NOT NULL,
    "referenceLabel" VARCHAR(80) NOT NULL DEFAULT 'Reference',
    "dueAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "akawo_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "akawo_pool_members" (
    "id" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "status" "AkawoPoolMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(6),

    CONSTRAINT "akawo_pool_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "akawo_pool_dues" (
    "id" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "AkawoDueStatus" NOT NULL DEFAULT 'PENDING',
    "ledgerTransactionId" UUID,
    "paidAt" TIMESTAMPTZ(6),
    "waivedReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "akawo_pool_dues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "akawo_pools_joinCodeDigest_key" ON "akawo_pools"("joinCodeDigest");

-- CreateIndex
CREATE INDEX "akawo_pools_organiserUserId_status_idx" ON "akawo_pools"("organiserUserId", "status");

-- CreateIndex
CREATE INDEX "akawo_pools_status_createdAt_idx" ON "akawo_pools"("status", "createdAt");

-- CreateIndex
CREATE INDEX "akawo_pool_members_poolId_status_idx" ON "akawo_pool_members"("poolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "akawo_pool_members_poolId_userId_key" ON "akawo_pool_members"("poolId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "akawo_pool_members_poolId_reference_key" ON "akawo_pool_members"("poolId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "akawo_pool_dues_ledgerTransactionId_key" ON "akawo_pool_dues"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "akawo_pool_dues_poolId_status_idx" ON "akawo_pool_dues"("poolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "akawo_pool_dues_poolId_memberId_key" ON "akawo_pool_dues"("poolId", "memberId");

-- AddForeignKey
ALTER TABLE "akawo_pools" ADD CONSTRAINT "akawo_pools_organiserUserId_fkey" FOREIGN KEY ("organiserUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "akawo_pool_members" ADD CONSTRAINT "akawo_pool_members_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "akawo_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "akawo_pool_members" ADD CONSTRAINT "akawo_pool_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "akawo_pool_dues" ADD CONSTRAINT "akawo_pool_dues_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "akawo_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "akawo_pool_dues" ADD CONSTRAINT "akawo_pool_dues_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "akawo_pool_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

