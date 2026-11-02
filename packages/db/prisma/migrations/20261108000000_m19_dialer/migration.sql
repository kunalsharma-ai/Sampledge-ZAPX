-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneHint" TEXT,
ADD COLUMN     "phoneSealed" TEXT;

-- CreateTable
CREATE TABLE "CatiDialer" (
    "surveyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "recordCalls" BOOLEAN NOT NULL DEFAULT false,
    "recordingNotice" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatiDialer_pkey" PRIMARY KEY ("surveyId")
);

-- CreateTable
CREATE TABLE "CatiDial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCallId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "respondentStatus" TEXT,
    "talkSeconds" INTEGER,
    "record" BOOLEAN NOT NULL DEFAULT false,
    "recordingStatus" TEXT NOT NULL DEFAULT 'none',
    "recordingSid" TEXT,
    "recordingTries" INTEGER NOT NULL DEFAULT 0,
    "captureId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "CatiDial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatiDial_providerCallId_key" ON "CatiDial"("providerCallId");

-- CreateIndex
CREATE INDEX "CatiDial_caseId_createdAt_idx" ON "CatiDial"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "CatiDial_recordingStatus_idx" ON "CatiDial"("recordingStatus");

