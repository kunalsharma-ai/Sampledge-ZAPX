-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'enterprise';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "scimExternalId" TEXT,
ADD COLUMN     "ssoSubject" TEXT;

-- CreateTable
CREATE TABLE "TenantSso" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretSealed" TEXT NOT NULL,
    "domains" TEXT[],
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "jitRole" "Role",
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSso_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "TenantScim" (
    "tenantId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "TenantScim_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantScim_prefix_key" ON "TenantScim"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_ssoSubject_key" ON "User"("tenantId", "ssoSubject");

-- AddForeignKey
ALTER TABLE "TenantSso" ADD CONSTRAINT "TenantSso_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantScim" ADD CONSTRAINT "TenantScim_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Response_tenantId_status_completedAt_idx" ON "Response"("tenantId", "status", "completedAt");
