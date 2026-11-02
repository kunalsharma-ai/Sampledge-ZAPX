-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('AI', 'IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('PROPOSED', 'APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "QaRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "respondents" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "report" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeSet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "baseVersionId" TEXT NOT NULL,
    "baseUpdatedAt" TIMESTAMP(3) NOT NULL,
    "source" "ChangeSource" NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT,
    "sourceFileName" TEXT,
    "proposedDefinition" JSONB NOT NULL,
    "diff" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "confidence" JSONB,
    "check" JSONB NOT NULL,
    "status" "ChangeStatus" NOT NULL DEFAULT 'PROPOSED',
    "producer" TEXT NOT NULL,
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QaRun_tenantId_surveyId_createdAt_idx" ON "QaRun"("tenantId", "surveyId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeSet_tenantId_surveyId_createdAt_idx" ON "ChangeSet"("tenantId", "surveyId", "createdAt");

-- AddForeignKey
ALTER TABLE "QaRun" ADD CONSTRAINT "QaRun_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
