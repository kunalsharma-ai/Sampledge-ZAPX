-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "deviceHash" TEXT,
ADD COLUMN     "geoCountry" TEXT,
ADD COLUMN     "location" JSONB,
ADD COLUMN     "signals" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "responseId" TEXT,
    "clientId" TEXT,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "responseId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Capture_storageKey_key" ON "Capture"("storageKey");

-- CreateIndex
CREATE INDEX "Capture_tenantId_surveyId_idx" ON "Capture"("tenantId", "surveyId");

-- CreateIndex
CREATE UNIQUE INDEX "Capture_clientId_ref_key" ON "Capture"("clientId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Capture_responseId_ref_key" ON "Capture"("responseId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "FraudBlock_tenantId_kind_hash_key" ON "FraudBlock"("tenantId", "kind", "hash");

-- CreateIndex
CREATE INDEX "Response_surveyId_deviceHash_idx" ON "Response"("surveyId", "deviceHash");

-- CreateIndex
CREATE INDEX "Response_interviewerId_startedAt_idx" ON "Response"("interviewerId", "startedAt");

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Photos and recordings are as sensitive as answers: the same tenant isolation policy as "Response" (ADR 0012).
ALTER TABLE "Capture" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Capture" FORCE ROW LEVEL SECURITY;
CREATE POLICY zapx_tenant_isolation ON "Capture"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
