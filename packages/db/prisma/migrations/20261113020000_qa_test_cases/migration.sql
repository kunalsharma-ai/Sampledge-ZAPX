-- Blueprint phase 2: saved QA test cases.
CREATE TABLE "QaTestCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaTestCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QaTestCase_surveyId_idx" ON "QaTestCase"("surveyId");
