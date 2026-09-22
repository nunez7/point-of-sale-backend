-- CreateEnum
CREATE TYPE "cotizacion_status" AS ENUM ('BORRADOR', 'ENVIADA', 'ACEPTADA', 'CANCELADA', 'VENCIDA');

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "cotizacionSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cotizacion" (
    "id" TEXT NOT NULL,
    "cotizacionNumber" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clienteId" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "cotizacion_status" NOT NULL DEFAULT 'BORRADOR',
    "notes" TEXT,
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledBy" TEXT,
    "convertedSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizacion_item" (
    "id" TEXT NOT NULL,
    "cotizacionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unidad" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "cotizacion_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_cotizacionNumber_key" ON "cotizacion"("cotizacionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_convertedSaleId_key" ON "cotizacion"("convertedSaleId");

-- CreateIndex
CREATE INDEX "cotizacion_storeId_createdAt_idx" ON "cotizacion"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "cotizacion_cotizacionNumber_idx" ON "cotizacion"("cotizacionNumber");

-- CreateIndex
CREATE INDEX "cotizacion_status_idx" ON "cotizacion"("status");

-- CreateIndex
CREATE INDEX "cotizacion_clienteId_idx" ON "cotizacion"("clienteId");

-- CreateIndex
CREATE INDEX "cotizacion_userId_idx" ON "cotizacion"("userId");

-- CreateIndex
CREATE INDEX "cotizacion_item_cotizacionId_idx" ON "cotizacion_item"("cotizacionId");

-- CreateIndex
CREATE INDEX "cotizacion_item_productId_idx" ON "cotizacion_item"("productId");

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_convertedSaleId_fkey" FOREIGN KEY ("convertedSaleId") REFERENCES "sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_item" ADD CONSTRAINT "cotizacion_item_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_item" ADD CONSTRAINT "cotizacion_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
