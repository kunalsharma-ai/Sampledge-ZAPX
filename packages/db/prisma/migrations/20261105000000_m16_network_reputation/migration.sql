-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "networkFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];

