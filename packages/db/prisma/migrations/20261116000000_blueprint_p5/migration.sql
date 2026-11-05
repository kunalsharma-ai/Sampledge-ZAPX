-- CreateEnum
CREATE TYPE "DistributionChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "AutomationRunState" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'RUNNING', 'DONE', 'SKIPPED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "phone" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Distribution" ADD COLUMN     "channel" "DistributionChannel" NOT NULL DEFAULT 'EMAIL';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "appearancePresets" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "blockExternalProcessors" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dataRegion" TEXT,
ADD COLUMN     "retention" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "surveyId" TEXT,
    "trigger" TEXT NOT NULL,
    "schedule" JSONB,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "lastFiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "state" "AutomationRunState" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "results" JSONB,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_tenantId_trigger_idx" ON "AutomationRule"("tenantId", "trigger");

-- CreateIndex
CREATE INDEX "AutomationRule_nextRunAt_idx" ON "AutomationRule"("nextRunAt");

-- CreateIndex
CREATE INDEX "AutomationRun_state_createdAt_idx" ON "AutomationRun"("state", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_ruleId_createdAt_idx" ON "AutomationRun"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_tenantId_state_idx" ON "AutomationRun"("tenantId", "state");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_surveyId_phone_key" ON "Contact"("surveyId", "phone");

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Blueprint phase 5: retention erasure marker
-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "erasedAt" TIMESTAMP(3);

