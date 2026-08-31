/*
  Warnings:

  - You are about to drop the column `motivo` on the `CajaMovimiento` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CajaMovimiento" DROP COLUMN "motivo",
ADD COLUMN     "motivoId" TEXT,
ADD COLUMN     "motivoTexto" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "umbralAlertaEfectivo" DECIMAL(12,2),
ADD COLUMN     "umbralAlertaEgresos" DECIMAL(12,2),
ADD COLUMN     "umbralAlertaTarjeta" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "CajaMovimientoMotivo" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CajaMovimientoMotivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CajaAlert" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cajaSessionId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "saldoDisponible" DECIMAL(12,2) NOT NULL,
    "umbral" DECIMAL(12,2) NOT NULL,
    "sobrepaso" DECIMAL(12,2) NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CajaAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CajaMovimientoMotivo_storeId_idx" ON "CajaMovimientoMotivo"("storeId");

-- CreateIndex
CREATE INDEX "CajaMovimientoMotivo_tipo_idx" ON "CajaMovimientoMotivo"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "CajaMovimientoMotivo_storeId_name_key" ON "CajaMovimientoMotivo"("storeId", "name");

-- CreateIndex
CREATE INDEX "CajaAlert_storeId_idx" ON "CajaAlert"("storeId");

-- CreateIndex
CREATE INDEX "CajaAlert_cajaSessionId_idx" ON "CajaAlert"("cajaSessionId");

-- CreateIndex
CREATE INDEX "CajaAlert_triggeredAt_idx" ON "CajaAlert"("triggeredAt");

-- AddForeignKey
ALTER TABLE "CajaMovimiento" ADD CONSTRAINT "CajaMovimiento_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "CajaMovimientoMotivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaMovimientoMotivo" ADD CONSTRAINT "CajaMovimientoMotivo_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaAlert" ADD CONSTRAINT "CajaAlert_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaAlert" ADD CONSTRAINT "CajaAlert_cajaSessionId_fkey" FOREIGN KEY ("cajaSessionId") REFERENCES "CajaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
