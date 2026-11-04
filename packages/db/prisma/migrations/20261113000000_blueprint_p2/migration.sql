-- Blueprint phase 2: translation glossary.
CREATE TABLE "GlossaryTerm" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlossaryTerm_tenantId_language_source_key" ON "GlossaryTerm"("tenantId", "language", "source");
