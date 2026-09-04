-- Holds one Ajo group's contributions between collection and payout (ADR-011).
-- A liability account: the pooled money belongs to the members. Deliberately
-- not attached to a wallet, so a group can never acquire the withdraw or spend
-- capabilities a wallet carries.
ALTER TYPE "FinancialAccountPurpose" ADD VALUE IF NOT EXISTS 'AJO_GROUP_POOL';
