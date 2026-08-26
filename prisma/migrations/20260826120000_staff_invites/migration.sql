-- CreateEnum
CREATE TYPE "StaffInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "staff_invites" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "roleId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "status" "StaffInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "acceptedUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_invites_tokenHash_key" ON "staff_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "staff_invites_email_status_idx" ON "staff_invites"("email", "status");

-- CreateIndex
CREATE INDEX "staff_invites_status_expiresAt_idx" ON "staff_invites"("status", "expiresAt");

-- At most one outstanding invite per address. A partial index cannot be
-- expressed in the Prisma schema, so it is created here and relied on by the
-- service to make concurrent invites fail rather than duplicate.
CREATE UNIQUE INDEX "staff_invites_pending_email_key"
    ON "staff_invites"("email") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
