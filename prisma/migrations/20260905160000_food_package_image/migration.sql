-- A photograph and a one-line description for a food package.
--
-- Both nullable: a package without either is still sellable, and the app falls
-- back to a coloured tile rather than a broken image. Stored as a URL rather
-- than bytes — the images are hosted, and a database is the wrong place to keep
-- a photograph.
ALTER TABLE "food_packages" ADD COLUMN IF NOT EXISTS "imageUrl" VARCHAR(500);
ALTER TABLE "food_packages" ADD COLUMN IF NOT EXISTS "description" VARCHAR(500);
