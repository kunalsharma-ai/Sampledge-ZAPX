-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('CAWI', 'CAPI');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('NONE', 'PENDING', 'ACCEPTED', 'REJECTED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'INTERVIEWER';

-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "interviewerId" TEXT,
ADD COLUMN     "ipHash" TEXT,
ADD COLUMN     "lastPageId" TEXT,
ADD COLUMN     "mode" "InterviewMode" NOT NULL DEFAULT 'CAWI',
ADD COLUMN     "pageShownAt" TIMESTAMP(3),
ADD COLUMN     "qualityFlags" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "qualityScore" INTEGER,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewState" "ReviewState" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OpenEndFingerprint" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenEndFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapiAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "target" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapiAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpenEndFingerprint_surveyId_questionId_hash_idx" ON "OpenEndFingerprint"("surveyId", "questionId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "OpenEndFingerprint_responseId_questionId_key" ON "OpenEndFingerprint"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "CapiAssignment_tenantId_interviewerId_idx" ON "CapiAssignment"("tenantId", "interviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "CapiAssignment_surveyId_interviewerId_key" ON "CapiAssignment"("surveyId", "interviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "Response_clientId_key" ON "Response"("clientId");

-- CreateIndex
CREATE INDEX "Response_surveyId_reviewState_idx" ON "Response"("surveyId", "reviewState");

-- CreateIndex
CREATE INDEX "Response_surveyId_ipHash_idx" ON "Response"("surveyId", "ipHash");

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapiAssignment" ADD CONSTRAINT "CapiAssignment_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapiAssignment" ADD CONSTRAINT "CapiAssignment_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

