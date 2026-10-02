-- Non-destructive migration adding immutable, non-sequential public identifiers
-- Preserves all existing production User and Host rows by backfilling from CUID primary keys

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "publicId" TEXT;
UPDATE "User"
SET "publicId" = 'usr_' || SUBSTRING(REGEXP_REPLACE("id", '[^a-zA-Z0-9]', '', 'g') FROM 1 FOR 18)
WHERE "publicId" IS NULL;
ALTER TABLE "User" ALTER COLUMN "publicId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_publicId_key" ON "User"("publicId");
CREATE INDEX IF NOT EXISTS "User_publicId_idx" ON "User"("publicId");

ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "publicId" TEXT;
UPDATE "Host"
SET "publicId" = 'srv_' || SUBSTRING(REGEXP_REPLACE("id", '[^a-zA-Z0-9]', '', 'g') FROM 1 FOR 18)
WHERE "publicId" IS NULL;
ALTER TABLE "Host" ALTER COLUMN "publicId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Host_publicId_key" ON "Host"("publicId");
CREATE INDEX IF NOT EXISTS "Host_publicId_idx" ON "Host"("publicId");
