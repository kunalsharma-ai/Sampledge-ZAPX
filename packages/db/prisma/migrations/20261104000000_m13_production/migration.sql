-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billingCustomerId" TEXT,
ADD COLUMN     "billingPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "billingStatus" TEXT,
ADD COLUMN     "billingSubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "TenantSso" ADD COLUMN     "protocol" TEXT NOT NULL DEFAULT 'OIDC',
ADD COLUMN     "samlCerts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "samlEntryPoint" TEXT,
ADD COLUMN     "samlIdpIssuer" TEXT;

-- CreateTable
CREATE TABLE "SsoRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "next" TEXT NOT NULL DEFAULT '/',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsoRequest_expiresAt_idx" ON "SsoRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "BillingEvent_createdAt_idx" ON "BillingEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_billingCustomerId_key" ON "Tenant"("billingCustomerId");

