-- Alter Store: secuencia de folios de compra
ALTER TABLE "Store" ADD COLUMN "purchaseSequence" INTEGER NOT NULL DEFAULT 0;

-- Alter SupplierTransaction: folio legible (ej. COMPRA-STORE001-0001)
ALTER TABLE "SupplierTransaction" ADD COLUMN "reference" TEXT;
UPDATE "SupplierTransaction" SET "reference" = "id" WHERE "reference" IS NULL;
ALTER TABLE "SupplierTransaction" ADD CONSTRAINT "SupplierTransaction_reference_key" UNIQUE ("reference");
ALTER TABLE "SupplierTransaction" ALTER COLUMN "reference" SET NOT NULL;

-- Alter SupplierTransactionItem: margen y precio de venta sugerido/sobrescrito
ALTER TABLE "SupplierTransactionItem" ADD COLUMN "marginPct" DECIMAL(5,2) NOT NULL DEFAULT 16;
ALTER TABLE "SupplierTransactionItem" ADD COLUMN "sellingPrice" DECIMAL(12,2);

-- Alter StockMovement: vínculo con la entidad de negocio origen
ALTER TABLE "StockMovement" ADD COLUMN "referenceType" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "referenceId" TEXT;
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType","referenceId");
