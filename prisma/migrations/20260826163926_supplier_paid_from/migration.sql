-- AlterTable
ALTER TABLE "SupplierTransaction" ADD COLUMN     "paidFrom" TEXT NOT NULL DEFAULT 'DUENO';

-- CreateIndex
CREATE INDEX "SupplierTransaction_paidFrom_idx" ON "SupplierTransaction"("paidFrom");
