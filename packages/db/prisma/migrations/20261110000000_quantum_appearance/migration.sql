-- Quantum Design System: personal appearance preferences and the organization default.
ALTER TABLE "User" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Tenant" ADD COLUMN "appearanceDefaults" JSONB NOT NULL DEFAULT '{}';
