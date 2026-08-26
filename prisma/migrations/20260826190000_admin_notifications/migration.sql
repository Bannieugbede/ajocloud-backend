-- CreateEnum
CREATE TYPE "AdminNotificationType" AS ENUM ('KYC_REVIEW_PENDING', 'COORDINATOR_APPLICATION_PENDING', 'SUPPORT_INQUIRY_OPENED', 'STAFF_INVITE_PENDING', 'WAITLIST_SIGNUP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AdminNotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" UUID NOT NULL,
    "type" "AdminNotificationType" NOT NULL,
    "severity" "AdminNotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "href" VARCHAR(200),
    "userId" UUID,
    "permission" VARCHAR(100),
    "subjectType" VARCHAR(64),
    "subjectId" UUID,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notification_reads" (
    "notificationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notification_reads_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE INDEX "admin_notifications_resolvedAt_createdAt_idx" ON "admin_notifications"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "admin_notifications_userId_createdAt_idx" ON "admin_notifications"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_notifications_type_subjectType_subjectId_key" ON "admin_notifications"("type", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "admin_notification_reads_userId_readAt_idx" ON "admin_notification_reads"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notification_reads" ADD CONSTRAINT "admin_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "admin_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notification_reads" ADD CONSTRAINT "admin_notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
