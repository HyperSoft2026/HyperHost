-- Non-destructive migration adding Support System model and status enum
-- Preserves all existing tables, rows, and migrations

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupportMessageStatus') THEN
    CREATE TYPE "SupportMessageStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportMessage" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "discordId" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SupportMessageStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SupportMessage_referenceId_key" ON "SupportMessage"("referenceId");
CREATE INDEX IF NOT EXISTS "SupportMessage_userId_idx" ON "SupportMessage"("userId");
CREATE INDEX IF NOT EXISTS "SupportMessage_referenceId_idx" ON "SupportMessage"("referenceId");
CREATE INDEX IF NOT EXISTS "SupportMessage_status_idx" ON "SupportMessage"("status");
CREATE INDEX IF NOT EXISTS "SupportMessage_createdAt_idx" ON "SupportMessage"("createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportMessage_userId_fkey'
  ) THEN
    ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
