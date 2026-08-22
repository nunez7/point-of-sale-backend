-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "codigoPostal" TEXT,
ADD COLUMN     "facturaSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "regimenFiscal" TEXT,
ADD COLUMN     "rfc" TEXT;

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "nombreRazonSocial" TEXT NOT NULL,
    "codigoPostal" TEXT NOT NULL,
    "regimenFiscal" TEXT NOT NULL,
    "usoCfdi" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Factura" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emisorRfc" TEXT NOT NULL,
    "emisorNombre" TEXT NOT NULL,
    "emisorRegimenFiscal" TEXT NOT NULL,
    "emisorCodigoPostal" TEXT NOT NULL,
    "receptorRfc" TEXT NOT NULL,
    "receptorNombre" TEXT NOT NULL,
    "receptorCodigoPostal" TEXT NOT NULL,
    "receptorRegimenFiscal" TEXT NOT NULL,
    "usoCfdi" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'MXN',
    "status" TEXT NOT NULL DEFAULT 'EMITIDA',
    "canceledAt" TIMESTAMP(3),
    "canceledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Factura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cliente_storeId_nombreRazonSocial_idx" ON "Cliente"("storeId", "nombreRazonSocial");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_storeId_rfc_key" ON "Cliente"("storeId", "rfc");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_folio_key" ON "Factura"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_saleId_key" ON "Factura"("saleId");

-- CreateIndex
CREATE INDEX "Factura_storeId_createdAt_idx" ON "Factura"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Factura_clienteId_idx" ON "Factura"("clienteId");

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
