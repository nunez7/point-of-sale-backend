-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cajaSessionId" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "aperturaCajaConInventario" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "controlCajas" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupplierTransaction" ADD COLUMN     "cajaSessionId" TEXT;

-- CreateTable
CREATE TABLE "Caja" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CajaSession" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openingElectronic" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openingNote" TEXT,
    "inventoryAdjusted" BOOLEAN,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closingCash" DECIMAL(12,2),
    "closingElectronic" DECIMAL(12,2),
    "closingNote" TEXT,
    "salesCash" DECIMAL(12,2),
    "salesElectronic" DECIMAL(12,2),
    "purchasesCash" DECIMAL(12,2),
    "purchasesElectronic" DECIMAL(12,2),
    "expectedCash" DECIMAL(12,2),
    "expectedElectronic" DECIMAL(12,2),
    "diffCash" DECIMAL(12,2),
    "diffElectronic" DECIMAL(12,2),

    CONSTRAINT "CajaSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Caja_storeId_idx" ON "Caja"("storeId");

-- CreateIndex
CREATE INDEX "Caja_assignedUserId_idx" ON "Caja"("assignedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Caja_storeId_name_key" ON "Caja"("storeId", "name");

-- CreateIndex
CREATE INDEX "CajaSession_storeId_status_idx" ON "CajaSession"("storeId", "status");

-- CreateIndex
CREATE INDEX "CajaSession_cajaId_idx" ON "CajaSession"("cajaId");

-- CreateIndex
CREATE INDEX "CajaSession_userId_idx" ON "CajaSession"("userId");

-- CreateIndex
CREATE INDEX "Sale_cajaSessionId_idx" ON "Sale"("cajaSessionId");

-- CreateIndex
CREATE INDEX "SupplierTransaction_cajaSessionId_idx" ON "SupplierTransaction"("cajaSessionId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cajaSessionId_fkey" FOREIGN KEY ("cajaSessionId") REFERENCES "CajaSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierTransaction" ADD CONSTRAINT "SupplierTransaction_cajaSessionId_fkey" FOREIGN KEY ("cajaSessionId") REFERENCES "CajaSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaSession" ADD CONSTRAINT "CajaSession_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaSession" ADD CONSTRAINT "CajaSession_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaSession" ADD CONSTRAINT "CajaSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
