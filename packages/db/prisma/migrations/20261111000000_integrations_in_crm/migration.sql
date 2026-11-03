-- Integrations configured in the CRM: platform-wide provider settings with sealed secrets, and the
-- organization that runs the installation (the oldest organization until another is chosen).
ALTER TABLE "Tenant" ADD COLUMN "platformOperator" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Tenant" SET "platformOperator" = true WHERE "id" = (SELECT "id" FROM "Tenant" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1);

CREATE TABLE "PlatformIntegration" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secretsSealed" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformIntegration_pkey" PRIMARY KEY ("key")
);
