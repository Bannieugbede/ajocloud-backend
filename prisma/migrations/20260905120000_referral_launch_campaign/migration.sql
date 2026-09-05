-- The launch referral campaign. See ADR-012.
--
-- Campaign terms are data rather than code so they can be changed without a
-- deploy. A campaign that has already paid rewards must never be edited in
-- place — a change in terms is a new `version` row — so this inserts once and
-- does nothing if it is already present.
--
-- ₦1,000 per qualified referral (100000 kobo), capped at 20 per referrer, so
-- the maximum exposure is ₦20,000 per referring account. Qualification is a
-- settled first deposit by a referred user verified to at least TIER_1.
INSERT INTO "referral_campaigns" (
  "id",
  "code",
  "version",
  "status",
  "qualifyingProduct",
  "qualifyingEvent",
  "minimumTransactionCount",
  "minimumAmountMinor",
  "requiredKycTier",
  "rewardAmountMinor",
  "rewardCurrency",
  "maximumRewards",
  "fraudRestrictions",
  "effectiveAt",
  "expiresAt",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  'LAUNCH',
  1,
  'ACTIVE',
  'WALLET',
  'deposit.settled',
  1,
  NULL,
  'TIER_1',
  100000,
  'NGN',
  20,
  -- Recorded as the campaign's declared controls. The service enforces each of
  -- these regardless of what is stored here; this documents the terms the
  -- campaign was launched under.
  '{"blockSelfReferral": true, "blockDuplicateIdentity": true, "oneRewardPerReferral": true, "reverseOnDepositReversal": true}'::jsonb,
  NOW(),
  NULL,
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "referral_campaigns" WHERE "code" = 'LAUNCH' AND "version" = 1
);
