-- CreateTable
CREATE TABLE "inventory_lot" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotCode" TEXT,
    "expirationDate" TIMESTAMP(3),
    "receivedQty" DECIMAL(12,3) NOT NULL,
    "availableQty" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "supplierTransactionItemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_item_lot" (
    "id" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sale_item_lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_lot_storeId_productId_expirationDate_idx" ON "inventory_lot"("storeId", "productId", "expirationDate");

-- CreateIndex
CREATE INDEX "inventory_lot_storeId_expirationDate_status_idx" ON "inventory_lot"("storeId", "expirationDate", "status");

-- CreateIndex
CREATE INDEX "inventory_lot_supplierTransactionItemId_idx" ON "inventory_lot"("supplierTransactionItemId");

-- CreateIndex
CREATE INDEX "sale_item_lot_lotId_idx" ON "sale_item_lot"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_item_lot_saleItemId_lotId_key" ON "sale_item_lot"("saleItemId", "lotId");

-- AddForeignKey
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_supplierTransactionItemId_fkey" FOREIGN KEY ("supplierTransactionItemId") REFERENCES "supplier_transaction_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item_lot" ADD CONSTRAINT "sale_item_lot_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item_lot" ADD CONSTRAINT "sale_item_lot_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "inventory_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: el stock que ya existe entra como un lote inicial por producto.
-- Si el producto tiene la fecha centinela (2100-02-02, "sin caducidad") el lote
-- queda sin fecha para que FEFO lo consuma al final.
INSERT INTO "inventory_lot" (
    "id", "storeId", "productId", "expirationDate",
    "receivedQty", "availableQty", "unitCost", "status", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    i."storeId",
    i."productId",
    CASE
        WHEN p."expirationDate" IS NULL OR p."expirationDate" >= TIMESTAMP '2100-01-01 00:00:00'
        THEN NULL
        ELSE p."expirationDate"
    END,
    i."quantity",
    i."quantity",
    p."costPrice",
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "inventory" i
INNER JOIN "product" p ON p."id" = i."productId"
WHERE i."quantity" > 0;
