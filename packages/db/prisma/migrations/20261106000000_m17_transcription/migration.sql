-- AlterTable
ALTER TABLE "Capture" ADD COLUMN     "transcribedAt" TIMESTAMP(3),
ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcriptLanguage" TEXT,
ADD COLUMN     "transcriptProvider" TEXT;

