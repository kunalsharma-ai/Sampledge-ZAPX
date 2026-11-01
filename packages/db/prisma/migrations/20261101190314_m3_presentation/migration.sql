-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "device" TEXT,
ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "SurveyVersion" ADD COLUMN     "presentation" JSONB NOT NULL DEFAULT '{}';
