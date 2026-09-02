-- AlterTable
ALTER TABLE "devices" ADD COLUMN "pushToken" VARCHAR(255),
ADD COLUMN "pushTokenAt" TIMESTAMPTZ(6),
ADD COLUMN "pushDeclinedAt" TIMESTAMPTZ(6),
ADD COLUMN "appVersion" VARCHAR(32),
ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "title" VARCHAR(200),
ADD COLUMN "body" VARCHAR(1000),
ADD COLUMN "deepLink" VARCHAR(300),
ADD COLUMN "readAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "devices_userId_pushToken_idx" ON "devices"("userId", "pushToken");

-- CreateIndex
CREATE INDEX "notifications_userId_channel_readAt_createdAt_idx" ON "notifications"("userId", "channel", "readAt", "createdAt");
