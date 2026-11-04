-- CreateEnum
CREATE TYPE "BackCheckMethod" AS ENUM ('PHONE', 'VISIT', 'RECORDING');

-- CreateEnum
CREATE TYPE "BackCheckState" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "AppealState" AS ENUM ('OPEN', 'UPHELD', 'OVERTURNED');

-- CreateEnum
CREATE TYPE "DistributionState" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvitationState" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "evidence" JSONB;

-- CreateTable
CREATE TABLE "BackCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "interviewerId" TEXT,
    "method" "BackCheckMethod" NOT NULL DEFAULT 'PHONE',
    "state" "BackCheckState" NOT NULL DEFAULT 'PENDING',
    "mismatches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "sampledById" TEXT NOT NULL,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityAppeal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "state" "AppealState" NOT NULL DEFAULT 'OPEN',
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "language" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Distribution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "reminderDays" INTEGER NOT NULL DEFAULT 0,
    "maxReminders" INTEGER NOT NULL DEFAULT 0,
    "reminderSubject" TEXT,
    "state" "DistributionState" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Distribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "state" "InvitationState" NOT NULL DEFAULT 'QUEUED',
    "sends" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "nextReminderAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackCheck_responseId_key" ON "BackCheck"("responseId");

-- CreateIndex
CREATE INDEX "BackCheck_surveyId_state_idx" ON "BackCheck"("surveyId", "state");

-- CreateIndex
CREATE INDEX "BackCheck_surveyId_interviewerId_idx" ON "BackCheck"("surveyId", "interviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityAppeal_responseId_key" ON "QualityAppeal"("responseId");

-- CreateIndex
CREATE INDEX "QualityAppeal_surveyId_state_idx" ON "QualityAppeal"("surveyId", "state");

-- CreateIndex
CREATE INDEX "QualityAppeal_raisedById_idx" ON "QualityAppeal"("raisedById");

-- CreateIndex
CREATE INDEX "Contact_tenantId_idx" ON "Contact"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_surveyId_email_key" ON "Contact"("surveyId", "email");

-- CreateIndex
CREATE INDEX "Distribution_surveyId_idx" ON "Distribution"("surveyId");

-- CreateIndex
CREATE INDEX "Distribution_state_sendAt_idx" ON "Distribution"("state", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_uid_key" ON "Invitation"("uid");

-- CreateIndex
CREATE INDEX "Invitation_nextReminderAt_idx" ON "Invitation"("nextReminderAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_distributionId_contactId_key" ON "Invitation"("distributionId", "contactId");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "Distribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

