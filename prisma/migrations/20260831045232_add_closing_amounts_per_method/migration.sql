-- AlterTable
ALTER TABLE "CajaSession" ADD COLUMN     "closingAmounts" JSONB,
ADD COLUMN     "diffByMethod" JSONB,
ADD COLUMN     "expectedAmounts" JSONB;
