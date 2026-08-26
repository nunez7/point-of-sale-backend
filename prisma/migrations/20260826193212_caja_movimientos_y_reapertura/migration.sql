-- AlterTable
ALTER TABLE "CajaSession" ADD COLUMN     "reopenReason" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "reopenedBy" TEXT;

-- CreateTable
CREATE TABLE "CajaMovimiento" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cajaSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "metodo" TEXT NOT NULL DEFAULT 'CASH',
    "monto" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CajaMovimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CajaMovimiento_storeId_idx" ON "CajaMovimiento"("storeId");

-- CreateIndex
CREATE INDEX "CajaMovimiento_cajaSessionId_idx" ON "CajaMovimiento"("cajaSessionId");

-- CreateIndex
CREATE INDEX "CajaMovimiento_userId_idx" ON "CajaMovimiento"("userId");

-- AddForeignKey
ALTER TABLE "CajaMovimiento" ADD CONSTRAINT "CajaMovimiento_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaMovimiento" ADD CONSTRAINT "CajaMovimiento_cajaSessionId_fkey" FOREIGN KEY ("cajaSessionId") REFERENCES "CajaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaMovimiento" ADD CONSTRAINT "CajaMovimiento_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
