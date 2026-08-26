-- AlterTable
ALTER TABLE "CajaSession" ADD COLUMN     "closingDate" TEXT,
ADD COLUMN     "openingDate" TEXT;

-- CreateIndex
CREATE INDEX "CajaSession_storeId_openingDate_idx" ON "CajaSession"("storeId", "openingDate");
