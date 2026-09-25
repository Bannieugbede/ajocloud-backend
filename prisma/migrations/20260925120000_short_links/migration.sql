-- Short public codes for shared links: ajocloud.com/g/<code> (Ajo groups),
-- /p/<code> (Akawo pools) and /f/<code> (Food Ajo programmes). See
-- docs/share-links.md.
--
-- A public code is not a secret. It names a group so a link can be short, be
-- shared again at any time, and be indexed when the organiser lists the group.
-- It admits nobody to an unlisted group: that still takes an invitation or a
-- join code.

-- The alphabet matches src/common/links/share-code.ts and the referral code:
-- 0/O, 1/I/L and 8/B are left out because those are the pairs people mistype
-- from a screenshot. random() is not cryptographic, which is fine for a value
-- that is not a secret; invitation and join codes are drawn in the application
-- from crypto.randomBytes.
CREATE OR REPLACE FUNCTION share_code(length INT) RETURNS TEXT
LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(
    substr('2345679ACDEFGHJKMNPQRTUVWXYZ', (floor(random() * 28) + 1)::int, 1),
    ''
  )
  FROM generate_series(1, length)
$$;

ALTER TABLE "ajo_groups" ADD COLUMN IF NOT EXISTS "shortCode" VARCHAR(16);
ALTER TABLE "ajo_groups" ADD COLUMN IF NOT EXISTS "publiclyListed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "akawo_pools" ADD COLUMN IF NOT EXISTS "shortCode" VARCHAR(16);
ALTER TABLE "akawo_pools" ADD COLUMN IF NOT EXISTS "publiclyListed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "food_ajo_groups" ADD COLUMN IF NOT EXISTS "shortCode" VARCHAR(16);

-- Backfills existing rows one at a time, drawing again on a clash, so the
-- unique indexes below cannot fail on a chance collision.
DO $$
DECLARE
  target_table TEXT;
  target_id UUID;
  candidate TEXT;
  taken BOOLEAN;
  attempts INT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['ajo_groups', 'akawo_pools', 'food_ajo_groups'] LOOP
    FOR target_id IN EXECUTE format('SELECT "id" FROM %I WHERE "shortCode" IS NULL', target_table) LOOP
      attempts := 0;
      LOOP
        candidate := share_code(7);
        -- EXECUTE does not set FOUND, so the clash check reads its answer.
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "shortCode" = $1)', target_table)
          INTO taken USING candidate;
        IF NOT taken THEN
          EXECUTE format('UPDATE %I SET "shortCode" = $1 WHERE "id" = $2', target_table)
            USING candidate, target_id;
          EXIT;
        END IF;
        attempts := attempts + 1;
        IF attempts > 20 THEN
          RAISE EXCEPTION 'Could not allocate a unique short code in % for %', target_table, target_id;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE "ajo_groups" ALTER COLUMN "shortCode" SET DEFAULT share_code(7);
ALTER TABLE "ajo_groups" ALTER COLUMN "shortCode" SET NOT NULL;
ALTER TABLE "akawo_pools" ALTER COLUMN "shortCode" SET DEFAULT share_code(7);
ALTER TABLE "akawo_pools" ALTER COLUMN "shortCode" SET NOT NULL;
ALTER TABLE "food_ajo_groups" ALTER COLUMN "shortCode" SET DEFAULT share_code(7);
ALTER TABLE "food_ajo_groups" ALTER COLUMN "shortCode" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ajo_groups_shortCode_key" ON "ajo_groups"("shortCode");
CREATE UNIQUE INDEX IF NOT EXISTS "akawo_pools_shortCode_key" ON "akawo_pools"("shortCode");
CREATE UNIQUE INDEX IF NOT EXISTS "food_ajo_groups_shortCode_key" ON "food_ajo_groups"("shortCode");
CREATE INDEX IF NOT EXISTS "ajo_groups_publiclyListed_status_idx" ON "ajo_groups"("publiclyListed", "status");
CREATE INDEX IF NOT EXISTS "akawo_pools_publiclyListed_status_idx" ON "akawo_pools"("publiclyListed", "status");
