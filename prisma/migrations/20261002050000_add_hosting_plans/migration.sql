-- CreateTable
CREATE TABLE IF NOT EXISTS "HostingPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cpuLimit" INTEGER NOT NULL DEFAULT 100,
    "memoryLimitMb" INTEGER NOT NULL DEFAULT 512,
    "storageLimitMb" INTEGER NOT NULL DEFAULT 800,
    "maxHosts" INTEGER NOT NULL DEFAULT 10,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HostingPlan_code_key" ON "HostingPlan"("code");
CREATE INDEX IF NOT EXISTS "HostingPlan_code_enabled_idx" ON "HostingPlan"("code", "enabled");

-- AlterTable
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "planId" TEXT;
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "storageLimitMb" INTEGER NOT NULL DEFAULT 800;
ALTER TABLE "Host" ALTER COLUMN "diskLimitMb" SET DEFAULT 800;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Host_planId_idx" ON "Host"("planId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Host_planId_fkey'
  ) THEN
    ALTER TABLE "Host" ADD CONSTRAINT "Host_planId_fkey" FOREIGN KEY ("planId") REFERENCES "HostingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed canonical FREE hosting plan
INSERT INTO "HostingPlan" ("id", "code", "name", "description", "cpuLimit", "memoryLimitMb", "storageLimitMb", "maxHosts", "enabled", "sortOrder", "createdAt", "updatedAt")
VALUES ('plan_free', 'FREE', 'Free Tier', 'خطة الاستضافة المجانية المخصصة لبوتات وتطبيقات HyperHost الأساسية.', 100, 512, 800, 10, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "cpuLimit" = 100,
  "memoryLimitMb" = 512,
  "storageLimitMb" = 800,
  "maxHosts" = 10,
  "enabled" = true;
