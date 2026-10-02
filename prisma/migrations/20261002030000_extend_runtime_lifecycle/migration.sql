-- Non-destructive migration extending HostStatus and NodeStatus lifecycle states
-- Preserves all existing production rows and migrations

ALTER TYPE "HostStatus" ADD VALUE IF NOT EXISTS 'CREATING';
ALTER TYPE "HostStatus" ADD VALUE IF NOT EXISTS 'RUNNING';
ALTER TYPE "HostStatus" ADD VALUE IF NOT EXISTS 'STOPPED';

ALTER TYPE "NodeStatus" ADD VALUE IF NOT EXISTS 'DEGRADED';
ALTER TYPE "NodeStatus" ADD VALUE IF NOT EXISTS 'DRAINING';
