-- Blueprint phase 2: least-fill randomized blocks.
ALTER TABLE "Response" ADD COLUMN "orderSeed" TEXT;

CREATE TABLE "BlockExposure" (
    "surveyId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BlockExposure_pkey" PRIMARY KEY ("surveyId","blockId","pageId")
);
