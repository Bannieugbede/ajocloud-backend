-- Food Ajo subscriptions become payable through the shared payment contract.
-- See docs/payments.md.

-- One escrow account per programme holds what its members have paid until
-- procurement, mirroring the Ajo group pool (ADR-011).
ALTER TYPE "FinancialAccountPurpose" ADD VALUE IF NOT EXISTS 'FOOD_PROGRAMME_ESCROW';

-- Existing subscriptions have paid nothing, which is the truth: no route could
-- settle one before this migration.
ALTER TABLE "food_subscriptions"
  ADD COLUMN "amountPaidMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "paidAt" TIMESTAMPTZ(6);

ALTER TABLE "food_subscriptions"
  ADD CONSTRAINT "food_subscriptions_amount_paid_non_negative" CHECK ("amountPaidMinor" >= 0);
