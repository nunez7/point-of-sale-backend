-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('ERROR_FACTURACION', 'CLIENTE_PROVEEDOR_SOLICITA', 'DUPLICADA', 'DEVOLUCION_MERCANCIA', 'CANCELACION_PEDIDO', 'OTRO');

-- AlterTable: Sale
ALTER TABLE "Sale" ADD COLUMN "cancellationReason" "CancellationReason",
ADD COLUMN "cancellationComment" TEXT;

-- AlterTable: SupplierTransaction
ALTER TABLE "SupplierTransaction" ADD COLUMN "canceledAt" TIMESTAMP(3),
ADD COLUMN "canceledBy" TEXT,
ADD COLUMN "cancellationReason" "CancellationReason",
ADD COLUMN "cancellationComment" TEXT;

-- AlterTable: Factura
ALTER TABLE "Factura" ADD COLUMN "cancellationReason" "CancellationReason",
ADD COLUMN "cancellationComment" TEXT;

-- CreateTable
CREATE TABLE "Cancellation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityNumber" TEXT NOT NULL,
    "reason" "CancellationReason" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cancellation_storeId_createdAt_idx" ON "Cancellation"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Cancellation_entityType_entityId_idx" ON "Cancellation"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
