-- The code a member shares to refer others. See ADR-012.
--
-- Nullable rather than required: the column has to exist before any code does,
-- and an account that predates the programme has none until it is backfilled
-- below. The application issues one at registration from then on.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCode" VARCHAR(32);

-- Backfills every existing account so no one is left without a code to share.
-- The alphabet matches src/modules/referrals/domain/referral-code.ts: 0/O,
-- 1/I/L and 8/B are excluded because those are the pairs people mistype from a
-- screenshot. The loop retries on the unique index rather than trusting a
-- single draw to be free of collisions.
DO $$
DECLARE
  target RECORD;
  candidate TEXT;
  attempts INT;
BEGIN
  FOR target IN SELECT "id" FROM "users" WHERE "referralCode" IS NULL LOOP
    attempts := 0;
    LOOP
      candidate := 'AJO-' || (
        SELECT string_agg(
          substr('2345679ACDEFGHJKMNPQRTUVWXYZ', (floor(random() * 28) + 1)::int, 1),
          ''
        )
        FROM generate_series(1, 6)
      );
      BEGIN
        UPDATE "users" SET "referralCode" = candidate WHERE "id" = target."id";
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 20 THEN
          RAISE EXCEPTION 'Could not allocate a unique referral code for user %', target."id";
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "users_referralCode_key" ON "users"("referralCode");
