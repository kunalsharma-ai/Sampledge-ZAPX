-- CreateEnum
CREATE TYPE "CatiCaseStatus" AS ENUM ('PENDING', 'CALLBACK', 'IN_CALL', 'DONE', 'CLOSED');

-- AlterEnum
ALTER TYPE "InterviewMode" ADD VALUE 'CATI';

-- CreateTable
CREATE TABLE "CatiCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "phoneSealed" TEXT NOT NULL,
    "phoneHint" TEXT NOT NULL,
    "name" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "CatiCaseStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextCallAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedById" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "lastDisposition" TEXT,
    "closedReason" TEXT,
    "responseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatiCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatiCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "note" TEXT,
    "callbackAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatiCase_responseId_key" ON "CatiCase"("responseId");

-- CreateIndex
CREATE INDEX "CatiCase_surveyId_status_nextCallAt_idx" ON "CatiCase"("surveyId", "status", "nextCallAt");

-- CreateIndex
CREATE INDEX "CatiCase_tenantId_surveyId_idx" ON "CatiCase"("tenantId", "surveyId");

-- CreateIndex
CREATE UNIQUE INDEX "CatiCase_surveyId_code_key" ON "CatiCase"("surveyId", "code");

-- CreateIndex
CREATE INDEX "CatiCall_caseId_idx" ON "CatiCall"("caseId");

-- CreateIndex
CREATE INDEX "CatiCall_tenantId_interviewerId_endedAt_idx" ON "CatiCall"("tenantId", "interviewerId", "endedAt");

-- AddForeignKey
ALTER TABLE "CatiCase" ADD CONSTRAINT "CatiCase_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatiCall" ADD CONSTRAINT "CatiCall_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CatiCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

