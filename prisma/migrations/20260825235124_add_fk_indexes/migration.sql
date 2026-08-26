-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "Cancellation_userId_idx" ON "Cancellation"("userId");

-- CreateIndex
CREATE INDEX "Factura_userId_idx" ON "Factura"("userId");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "RevokedToken_userId_idx" ON "RevokedToken"("userId");

-- CreateIndex
CREATE INDEX "Sale_userId_idx" ON "Sale"("userId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_userId_idx" ON "StockMovement"("userId");

-- CreateIndex
CREATE INDEX "SupplierTransaction_supplierId_idx" ON "SupplierTransaction"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierTransaction_userId_idx" ON "SupplierTransaction"("userId");

-- CreateIndex
CREATE INDEX "SupplierTransactionItem_transactionId_idx" ON "SupplierTransactionItem"("transactionId");

-- CreateIndex
CREATE INDEX "SupplierTransactionItem_productId_idx" ON "SupplierTransactionItem"("productId");

-- CreateIndex
CREATE INDEX "User_storeId_idx" ON "User"("storeId");
