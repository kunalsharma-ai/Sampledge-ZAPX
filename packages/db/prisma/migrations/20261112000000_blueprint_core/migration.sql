-- Blueprint phase 1: live quota target changes.
ALTER TABLE "QuotaCount" ADD COLUMN "targetOverride" INTEGER;

-- Blueprint phase 1: question bank and organization templates.
CREATE TYPE "LibraryItemKind" AS ENUM ('QUESTION', 'SURVEY');

CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "LibraryItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LibraryItem_tenantId_kind_idx" ON "LibraryItem"("tenantId", "kind");
