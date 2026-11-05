-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "adminNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "featureOverrides" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "featureOverrides" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "lastClient" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "mobileAccess" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "superAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "interval" TEXT NOT NULL DEFAULT 'month',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "webFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mobileFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PlatformAutomation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAutomationRun_createdAt_idx" ON "PlatformAutomationRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAutomationRun_automationId_dedupeKey_key" ON "PlatformAutomationRun"("automationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "PlatformAutomationRun" ADD CONSTRAINT "PlatformAutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "PlatformAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

