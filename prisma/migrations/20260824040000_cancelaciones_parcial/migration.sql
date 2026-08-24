-- AlterTable
ALTER TABLE "Cancellation" DROP COLUMN "reason",
ADD COLUMN     "cancellationReasonId" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'FULL';

-- AlterTable
ALTER TABLE "Factura" DROP COLUMN "cancellationReason",
ADD COLUMN     "cancellationReasonId" TEXT;

-- AlterTable
ALTER TABLE "Sale" DROP COLUMN "cancellationReason",
ADD COLUMN     "cancellationReasonId" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "canceledBy" TEXT,
ADD COLUMN     "cancellationId" TEXT;

-- AlterTable
ALTER TABLE "SupplierTransaction" DROP COLUMN "cancellationReason",
ADD COLUMN     "cancellationReasonId" TEXT;

-- DropEnum
DROP TYPE "CancellationReason";

-- CreateTable
CREATE TABLE "CancellationReason" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationItem" (
    "id" TEXT NOT NULL,
    "cancellationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unidad" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "profit" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CancellationReason_storeId_idx" ON "CancellationReason"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationReason_storeId_name_key" ON "CancellationReason"("storeId", "name");

-- CreateIndex
CREATE INDEX "CancellationItem_cancellationId_idx" ON "CancellationItem"("cancellationId");

-- CreateIndex
CREATE INDEX "CancellationItem_storeId_idx" ON "CancellationItem"("storeId");

-- CreateIndex
CREATE INDEX "CancellationItem_productId_idx" ON "CancellationItem"("productId");

-- CreateIndex
CREATE INDEX "CancellationItem_saleItemId_idx" ON "CancellationItem"("saleItemId");

-- CreateIndex
CREATE INDEX "Cancellation_cancellationReasonId_idx" ON "Cancellation"("cancellationReasonId");

-- AddForeignKey
ALTER TABLE "CancellationReason" ADD CONSTRAINT "CancellationReason_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cancellationReasonId_fkey" FOREIGN KEY ("cancellationReasonId") REFERENCES "CancellationReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "Cancellation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierTransaction" ADD CONSTRAINT "SupplierTransaction_cancellationReasonId_fkey" FOREIGN KEY ("cancellationReasonId") REFERENCES "CancellationReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_cancellationReasonId_fkey" FOREIGN KEY ("cancellationReasonId") REFERENCES "CancellationReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_cancellationReasonId_fkey" FOREIGN KEY ("cancellationReasonId") REFERENCES "CancellationReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationItem" ADD CONSTRAINT "CancellationItem_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "Cancellation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

