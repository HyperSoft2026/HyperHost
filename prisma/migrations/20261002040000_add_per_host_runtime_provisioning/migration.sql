-- Non-destructive migration adding Automatic Per-Host Runtime Provisioning fields and lifecycle states
-- Preserves all existing production tables, rows, and migrations

ALTER TYPE "HostStatus" ADD VALUE IF NOT EXISTS 'PROVISIONING';
ALTER TYPE "HostStatus" ADD VALUE IF NOT EXISTS 'BOOTSTRAPPING';
ALTER TYPE "HostStatus" ADD VALUE IF NOT EXISTS 'NODE_CONNECTING';
ALTER TYPE "HostStatus" ADD VALUE IF NOT EXISTS 'NODE_ONLINE';

ALTER TABLE "Node" ADD COLUMN IF NOT EXISTS "bootstrapTokenEncrypted" TEXT;
ALTER TABLE "Node" ADD COLUMN IF NOT EXISTS "dedicatedHostId" TEXT;
ALTER TABLE "Node" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "Node" ADD COLUMN IF NOT EXISTS "provisionedServerId" TEXT;
ALTER TABLE "Node" ADD COLUMN IF NOT EXISTS "serverStatus" TEXT NOT NULL DEFAULT 'OFFLINE';

CREATE UNIQUE INDEX IF NOT EXISTS "Node_dedicatedHostId_key" ON "Node"("dedicatedHostId");

ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "provisionedServerId" TEXT;
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "provisioningStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "serverStatus" TEXT NOT NULL DEFAULT 'UNPROVISIONED';
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "provisioningError" TEXT;
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "provisionedAt" TIMESTAMP(3);
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "bootstrappedAt" TIMESTAMP(3);
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "nodeConnectedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Host_provisioningStatus_idx" ON "Host"("provisioningStatus");
