-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "wantsPromotions" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_inquiries" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(20),
    "subject" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waitlist_entries_status_createdAt_idx" ON "waitlist_entries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_email_key" ON "waitlist_entries"("email");

-- CreateIndex
CREATE INDEX "support_inquiries_status_createdAt_idx" ON "support_inquiries"("status", "createdAt");
