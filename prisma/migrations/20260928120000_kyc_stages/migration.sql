-- Staged verification (ADR-015).

-- Documents are held encrypted in the database until object storage exists.
ALTER TABLE "verification_documents"
  ADD COLUMN "contentType" VARCHAR(100),
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "ciphertext" BYTEA,
  ADD COLUMN "supersededAt" TIMESTAMPTZ(6);

CREATE INDEX "verification_documents_kycProfileId_type_supersededAt_idx"
  ON "verification_documents"("kycProfileId", "type", "supersededAt");

-- Tier 2 and Tier 3 now need a NIN document and a matched address, neither of
-- which could be supplied before this migration. No existing profile can meet
-- them, so every higher tier is withdrawn and `level` restarts as the count of
-- completed stages; both are recomputed from the evidence on the next read.
UPDATE "kyc_profiles" SET "tier" = 'TIER_1', "level" = 0 WHERE "tier" <> 'TIER_1' OR "level" <> 0;
