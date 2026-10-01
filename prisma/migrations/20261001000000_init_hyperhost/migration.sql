-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "HostType" AS ENUM ('DISCORD_BOT', 'TELEGRAM_BOT', 'NODEJS_APP', 'PYTHON_APP', 'JAVA_APP', 'GO_APP', 'RUST_APP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "HostRuntime" AS ENUM ('NODEJS', 'PYTHON', 'JAVA', 'GO', 'RUST', 'PHP', 'RUBY', 'DOTNET', 'CPP');

-- CreateEnum
CREATE TYPE "HostStatus" AS ENUM ('PENDING', 'INSTALLING', 'OFFLINE', 'STARTING', 'ONLINE', 'STOPPING', 'SUSPENDED', 'ERROR');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('ONLINE', 'OFFLINE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "AllocationProtocol" AS ENUM ('TCP', 'UDP', 'BOTH');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'RESERVED');

-- CreateEnum
CREATE TYPE "DatabaseEngine" AS ENUM ('POSTGRESQL', 'MYSQL', 'MONGODB', 'REDIS');

-- CreateEnum
CREATE TYPE "DatabaseStatus" AS ENUM ('PENDING', 'READY', 'ERROR', 'DELETING');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RESTORING');

-- CreateEnum
CREATE TYPE "ScheduleTaskType" AS ENUM ('POWER_START', 'POWER_STOP', 'POWER_RESTART', 'EXECUTE_COMMAND', 'CREATE_BACKUP');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatar" TEXT,
    "email" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "avatar" TEXT,
    "email" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "daemonPort" INTEGER NOT NULL DEFAULT 8080,
    "status" "NodeStatus" NOT NULL DEFAULT 'OFFLINE',
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "agentTokenHash" TEXT NOT NULL,
    "maxMemoryMb" INTEGER NOT NULL,
    "maxDiskMb" INTEGER NOT NULL,
    "maxCpuPercent" INTEGER NOT NULL DEFAULT 1000,
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeAllocation" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "hostId" TEXT,
    "ipAddress" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" "AllocationProtocol" NOT NULL DEFAULT 'TCP',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "AllocationStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Host" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "nodeId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "HostType" NOT NULL DEFAULT 'DISCORD_BOT',
    "runtime" "HostRuntime" NOT NULL DEFAULT 'NODEJS',
    "runtimeVersion" TEXT NOT NULL DEFAULT '22',
    "status" "HostStatus" NOT NULL DEFAULT 'PENDING',
    "memoryLimitMb" INTEGER NOT NULL DEFAULT 512,
    "cpuLimitPercent" INTEGER NOT NULL DEFAULT 100,
    "diskLimitMb" INTEGER NOT NULL DEFAULT 2048,
    "startupCommand" TEXT NOT NULL DEFAULT 'node index.js',
    "startupArgs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workingDirectory" TEXT NOT NULL DEFAULT '/home/container',
    "dockerImage" TEXT NOT NULL DEFAULT 'ghcr.io/hypersoft2026/runtime-nodejs:22',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostEnvironment" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostPermission" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "hostId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "taskType" "ScheduleTaskType" NOT NULL,
    "payload" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "onlyWhenOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "storageProvider" TEXT NOT NULL DEFAULT 's3',
    "storageKey" TEXT,
    "checksumSha256" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Database" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "nodeId" TEXT,
    "engine" "DatabaseEngine" NOT NULL DEFAULT 'POSTGRESQL',
    "name" TEXT NOT NULL,
    "hostAddress" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "maxConnections" INTEGER NOT NULL DEFAULT 25,
    "status" "DatabaseStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Database_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseUser" (
    "id" TEXT NOT NULL,
    "databaseId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "remoteHost" TEXT NOT NULL DEFAULT '%',
    "privileges" TEXT[] DEFAULT ARRAY['ALL']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
CREATE INDEX "User_discordId_idx" ON "User"("discordId");
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordAccount_userId_key" ON "DiscordAccount"("userId");
CREATE UNIQUE INDEX "DiscordAccount_discordId_key" ON "DiscordAccount"("discordId");
CREATE INDEX "DiscordAccount_discordId_idx" ON "DiscordAccount"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Node_name_key" ON "Node"("name");
CREATE UNIQUE INDEX "Node_agentTokenHash_key" ON "Node"("agentTokenHash");
CREATE INDEX "Node_status_isOnline_idx" ON "Node"("status", "isOnline");

-- CreateIndex
CREATE UNIQUE INDEX "NodeAllocation_nodeId_ipAddress_port_protocol_key" ON "NodeAllocation"("nodeId", "ipAddress", "port", "protocol");
CREATE INDEX "NodeAllocation_hostId_idx" ON "NodeAllocation"("hostId");
CREATE INDEX "NodeAllocation_nodeId_status_idx" ON "NodeAllocation"("nodeId", "status");

-- CreateIndex
CREATE INDEX "Host_ownerId_idx" ON "Host"("ownerId");
CREATE INDEX "Host_nodeId_idx" ON "Host"("nodeId");
CREATE INDEX "Host_status_idx" ON "Host"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HostEnvironment_hostId_key_key" ON "HostEnvironment"("hostId", "key");
CREATE INDEX "HostEnvironment_hostId_idx" ON "HostEnvironment"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "HostPermission_hostId_userId_key" ON "HostPermission"("hostId", "userId");
CREATE INDEX "HostPermission_userId_idx" ON "HostPermission"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_hostId_createdAt_idx" ON "ActivityLog"("hostId", "createdAt");
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");

-- CreateIndex
CREATE INDEX "Schedule_hostId_isActive_idx" ON "Schedule"("hostId", "isActive");

-- CreateIndex
CREATE INDEX "Backup_hostId_createdAt_idx" ON "Backup"("hostId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Database_hostId_name_key" ON "Database"("hostId", "name");
CREATE INDEX "Database_hostId_idx" ON "Database"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseUser_databaseId_username_key" ON "DatabaseUser"("databaseId", "username");

-- AddForeignKey
ALTER TABLE "DiscordAccount" ADD CONSTRAINT "DiscordAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeAllocation" ADD CONSTRAINT "NodeAllocation_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeAllocation" ADD CONSTRAINT "NodeAllocation_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Host" ADD CONSTRAINT "Host_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Host" ADD CONSTRAINT "Host_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostEnvironment" ADD CONSTRAINT "HostEnvironment_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostPermission" ADD CONSTRAINT "HostPermission_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostPermission" ADD CONSTRAINT "HostPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Database" ADD CONSTRAINT "Database_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Database" ADD CONSTRAINT "Database_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseUser" ADD CONSTRAINT "DatabaseUser_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database"("id") ON DELETE CASCADE ON UPDATE CASCADE;
