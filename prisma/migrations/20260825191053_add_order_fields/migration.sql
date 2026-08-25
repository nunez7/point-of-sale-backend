-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "clienteId" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedBy" TEXT,
ADD COLUMN     "notes" TEXT;

-- CreateIndex
CREATE INDEX "Sale_status_idx" ON "Sale"("status");

-- CreateIndex
CREATE INDEX "Sale_clienteId_idx" ON "Sale"("clienteId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
