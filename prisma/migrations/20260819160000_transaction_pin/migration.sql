-- CreateTable
CREATE TABLE "transaction_pins" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "pinHash" VARCHAR(255) NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastUsedAt" TIMESTAMPTZ(6),
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transaction_pins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_pins_userId_key" ON "transaction_pins"("userId");

-- AddForeignKey
ALTER TABLE "transaction_pins"
  ADD CONSTRAINT "transaction_pins_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
