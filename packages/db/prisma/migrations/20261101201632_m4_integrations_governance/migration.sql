-- CreateEnum
CREATE TYPE "VendorIntegration" AS ENUM ('DIRECT', 'PROJEXA');

-- CreateEnum
CREATE TYPE "CallbackState" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ResponseStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "ResponseStatus" ADD VALUE 'TECHNICAL_ERROR';

-- DropIndex
DROP INDEX "Project_tenantId_idx";

-- DropIndex
DROP INDEX "Survey_tenantId_projectId_idx";

-- DropIndex
DROP INDEX "Vendor_tenantId_idx";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "redirectDefaults" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Survey" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "redirectDefaults" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "callbackMaxAttempts" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "callbackStatuses" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "callbackUrl" TEXT,
ADD COLUMN     "countryRedirects" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "integration" "VendorIntegration" NOT NULL DEFAULT 'DIRECT',
ADD COLUMN     "partnerBaseUrl" TEXT,
ADD COLUMN     "partnerS2s" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "partnerSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "RedirectEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "responseId" TEXT,
    "vendorId" TEXT,
    "uid" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusWord" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "level" TEXT,
    "url" TEXT,
    "reason" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedirectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundCallback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "integration" "VendorIntegration" NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" JSONB,
    "state" "CallbackState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "log" JSONB NOT NULL DEFAULT '[]',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundCallback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAiPolicy" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedTasks" TEXT[] DEFAULT ARRAY['architect', 'translate']::TEXT[],
    "requestsPerMinute" INTEGER NOT NULL DEFAULT 10,
    "requestsPerDay" INTEGER NOT NULL DEFAULT 500,
    "monthlyBudgetMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "redactPii" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAiPolicy_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "surveyId" TEXT,
    "redactions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RedirectEvent_tenantId_vendorId_createdAt_idx" ON "RedirectEvent"("tenantId", "vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "RedirectEvent_tenantId_surveyId_createdAt_idx" ON "RedirectEvent"("tenantId", "surveyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RedirectEvent_responseId_status_key" ON "RedirectEvent"("responseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundCallback_idempotencyKey_key" ON "OutboundCallback"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboundCallback_state_nextAttemptAt_idx" ON "OutboundCallback"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboundCallback_tenantId_vendorId_createdAt_idx" ON "OutboundCallback"("tenantId", "vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_tenantId_createdAt_idx" ON "AiUsage"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_tenantId_task_createdAt_idx" ON "AiUsage"("tenantId", "task", "createdAt");

-- CreateIndex
CREATE INDEX "Project_tenantId_deletedAt_idx" ON "Project"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "Response_vendorId_completedAt_idx" ON "Response"("vendorId", "completedAt");

-- CreateIndex
CREATE INDEX "Response_status_updatedAt_idx" ON "Response"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Survey_tenantId_projectId_deletedAt_idx" ON "Survey"("tenantId", "projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_deletedAt_idx" ON "Vendor"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "RedirectEvent" ADD CONSTRAINT "RedirectEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundCallback" ADD CONSTRAINT "OutboundCallback_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAiPolicy" ADD CONSTRAINT "TenantAiPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
