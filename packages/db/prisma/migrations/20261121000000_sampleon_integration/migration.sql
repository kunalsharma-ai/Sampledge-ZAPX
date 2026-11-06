-- SAMPLEON integration: ZAPX as the survey host behind SAMPLEON (SAMPLEON docs/ECOSYSTEM_ARCHITECTURE.md).
ALTER TYPE "VendorIntegration" ADD VALUE 'SAMPLEON';

CREATE TABLE "SampleonAudienceRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "audienceRequestId" TEXT NOT NULL,
    "sourcePlatform" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredCompletes" INTEGER NOT NULL,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "progressSequence" INTEGER NOT NULL DEFAULT 0,
    "lastEventType" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SampleonAudienceRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SampleonAudienceRequest_audienceRequestId_key" ON "SampleonAudienceRequest"("audienceRequestId");
CREATE INDEX "SampleonAudienceRequest_tenantId_surveyId_idx" ON "SampleonAudienceRequest"("tenantId", "surveyId");

CREATE TABLE "SampleonInboundEvent" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "audienceRequestId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleonInboundEvent_pkey" PRIMARY KEY ("eventId")
);

-- Same tenant-isolation policy as the other tenant tables (ADR 0012).
ALTER TABLE "SampleonAudienceRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SampleonAudienceRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY zapx_tenant_isolation ON "SampleonAudienceRequest"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
