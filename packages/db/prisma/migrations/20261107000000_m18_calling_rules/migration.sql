-- AlterTable
ALTER TABLE "CatiCase" ADD COLUMN     "phoneHash" TEXT,
ADD COLUMN     "timeZone" TEXT;

-- CreateTable
CREATE TABLE "CatiSettings" (
    "surveyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "callFrom" INTEGER NOT NULL DEFAULT 540,
    "callUntil" INTEGER NOT NULL DEFAULT 1260,
    "days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatiSettings_pkey" PRIMARY KEY ("surveyId")
);

-- CreateTable
CREATE TABLE "DoNotCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoNotCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoNotCall_tenantId_phoneHash_key" ON "DoNotCall"("tenantId", "phoneHash");

-- CreateIndex
CREATE INDEX "CatiCase_tenantId_phoneHash_idx" ON "CatiCase"("tenantId", "phoneHash");

