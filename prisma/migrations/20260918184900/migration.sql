-- AlterTable
ALTER TABLE "audit_log" RENAME CONSTRAINT "AuditLog_pkey" TO "audit_log_pkey";

-- AlterTable
ALTER TABLE "caja" RENAME CONSTRAINT "Caja_pkey" TO "caja_pkey";

-- AlterTable
ALTER TABLE "caja_alert" RENAME CONSTRAINT "CajaAlert_pkey" TO "caja_alert_pkey";

-- AlterTable
ALTER TABLE "caja_movimiento" RENAME CONSTRAINT "CajaMovimiento_pkey" TO "caja_movimiento_pkey";

-- AlterTable
ALTER TABLE "caja_movimiento_motivo" RENAME CONSTRAINT "CajaMovimientoMotivo_pkey" TO "caja_movimiento_motivo_pkey";

-- AlterTable
ALTER TABLE "caja_session" RENAME CONSTRAINT "CajaSession_pkey" TO "caja_session_pkey";

-- AlterTable
ALTER TABLE "cancellation" RENAME CONSTRAINT "Cancellation_pkey" TO "cancellation_pkey";

-- AlterTable
ALTER TABLE "cancellation_item" RENAME CONSTRAINT "CancellationItem_pkey" TO "cancellation_item_pkey";

-- AlterTable
ALTER TABLE "cancellation_reason" RENAME CONSTRAINT "CancellationReason_pkey" TO "cancellation_reason_pkey";

-- AlterTable
ALTER TABLE "category" RENAME CONSTRAINT "Category_pkey" TO "category_pkey";

-- AlterTable
ALTER TABLE "cliente" RENAME CONSTRAINT "Cliente_pkey" TO "cliente_pkey";

-- AlterTable
ALTER TABLE "factura" RENAME CONSTRAINT "Factura_pkey" TO "factura_pkey";

-- AlterTable
ALTER TABLE "inventory" RENAME CONSTRAINT "Inventory_pkey" TO "inventory_pkey";

-- AlterTable
ALTER TABLE "inventory_snapshot" RENAME CONSTRAINT "InventorySnapshot_pkey" TO "inventory_snapshot_pkey";

-- AlterTable
ALTER TABLE "movement_reason" RENAME CONSTRAINT "MovementReason_pkey" TO "movement_reason_pkey";

-- AlterTable
ALTER TABLE "product" RENAME CONSTRAINT "Product_pkey" TO "product_pkey";

-- AlterTable
ALTER TABLE "promotion" RENAME CONSTRAINT "Promotion_pkey" TO "promotion_pkey";

-- AlterTable
ALTER TABLE "promotion_application" RENAME CONSTRAINT "PromotionApplication_pkey" TO "promotion_application_pkey";

-- AlterTable
ALTER TABLE "promotion_item" RENAME CONSTRAINT "PromotionItem_pkey" TO "promotion_item_pkey";

-- AlterTable
ALTER TABLE "revoked_token" RENAME CONSTRAINT "RevokedToken_pkey" TO "revoked_token_pkey";

-- AlterTable
ALTER TABLE "sale" RENAME CONSTRAINT "Sale_pkey" TO "sale_pkey";

-- AlterTable
ALTER TABLE "sale_item" RENAME CONSTRAINT "SaleItem_pkey" TO "sale_item_pkey";

-- AlterTable
ALTER TABLE "stock_movement" RENAME CONSTRAINT "StockMovement_pkey" TO "stock_movement_pkey";

-- AlterTable
ALTER TABLE "store" RENAME CONSTRAINT "Store_pkey" TO "store_pkey";

-- AlterTable
ALTER TABLE "supplier" RENAME CONSTRAINT "Supplier_pkey" TO "supplier_pkey";

-- AlterTable
ALTER TABLE "supplier_transaction" RENAME CONSTRAINT "SupplierTransaction_pkey" TO "supplier_transaction_pkey";

-- AlterTable
ALTER TABLE "supplier_transaction_item" RENAME CONSTRAINT "SupplierTransactionItem_pkey" TO "supplier_transaction_item_pkey";

-- AlterTable
ALTER TABLE "ticket" RENAME CONSTRAINT "Ticket_pkey" TO "ticket_pkey";

-- AlterTable
ALTER TABLE "ticket_attachment" RENAME CONSTRAINT "TicketAttachment_pkey" TO "ticket_attachment_pkey";

-- AlterTable
ALTER TABLE "ticket_comment" RENAME CONSTRAINT "TicketComment_pkey" TO "ticket_comment_pkey";

-- AlterTable
ALTER TABLE "ticket_config" RENAME CONSTRAINT "TicketConfig_pkey" TO "ticket_config_pkey";

-- AlterTable
ALTER TABLE "user" RENAME CONSTRAINT "User_pkey" TO "user_pkey";

-- AlterTable
ALTER TABLE "user_store" RENAME CONSTRAINT "UserStore_pkey" TO "user_store_pkey";

-- RenameForeignKey
ALTER TABLE "audit_log" RENAME CONSTRAINT "AuditLog_storeId_fkey" TO "audit_log_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "audit_log" RENAME CONSTRAINT "AuditLog_userId_fkey" TO "audit_log_userId_fkey";

-- RenameForeignKey
ALTER TABLE "caja" RENAME CONSTRAINT "Caja_assignedUserId_fkey" TO "caja_assignedUserId_fkey";

-- RenameForeignKey
ALTER TABLE "caja" RENAME CONSTRAINT "Caja_storeId_fkey" TO "caja_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_alert" RENAME CONSTRAINT "CajaAlert_cajaSessionId_fkey" TO "caja_alert_cajaSessionId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_alert" RENAME CONSTRAINT "CajaAlert_storeId_fkey" TO "caja_alert_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_movimiento" RENAME CONSTRAINT "CajaMovimiento_cajaSessionId_fkey" TO "caja_movimiento_cajaSessionId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_movimiento" RENAME CONSTRAINT "CajaMovimiento_motivoId_fkey" TO "caja_movimiento_motivoId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_movimiento" RENAME CONSTRAINT "CajaMovimiento_storeId_fkey" TO "caja_movimiento_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_movimiento" RENAME CONSTRAINT "CajaMovimiento_userId_fkey" TO "caja_movimiento_userId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_movimiento_motivo" RENAME CONSTRAINT "CajaMovimientoMotivo_storeId_fkey" TO "caja_movimiento_motivo_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_session" RENAME CONSTRAINT "CajaSession_cajaId_fkey" TO "caja_session_cajaId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_session" RENAME CONSTRAINT "CajaSession_storeId_fkey" TO "caja_session_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "caja_session" RENAME CONSTRAINT "CajaSession_userId_fkey" TO "caja_session_userId_fkey";

-- RenameForeignKey
ALTER TABLE "cancellation" RENAME CONSTRAINT "Cancellation_cancellationReasonId_fkey" TO "cancellation_cancellationReasonId_fkey";

-- RenameForeignKey
ALTER TABLE "cancellation" RENAME CONSTRAINT "Cancellation_storeId_fkey" TO "cancellation_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "cancellation" RENAME CONSTRAINT "Cancellation_userId_fkey" TO "cancellation_userId_fkey";

-- RenameForeignKey
ALTER TABLE "cancellation_item" RENAME CONSTRAINT "CancellationItem_cancellationId_fkey" TO "cancellation_item_cancellationId_fkey";

-- RenameForeignKey
ALTER TABLE "cancellation_reason" RENAME CONSTRAINT "CancellationReason_storeId_fkey" TO "cancellation_reason_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "category" RENAME CONSTRAINT "Category_storeId_fkey" TO "category_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "cliente" RENAME CONSTRAINT "Cliente_storeId_fkey" TO "cliente_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "factura" RENAME CONSTRAINT "Factura_cancellationReasonId_fkey" TO "factura_cancellationReasonId_fkey";

-- RenameForeignKey
ALTER TABLE "factura" RENAME CONSTRAINT "Factura_clienteId_fkey" TO "factura_clienteId_fkey";

-- RenameForeignKey
ALTER TABLE "factura" RENAME CONSTRAINT "Factura_saleId_fkey" TO "factura_saleId_fkey";

-- RenameForeignKey
ALTER TABLE "factura" RENAME CONSTRAINT "Factura_storeId_fkey" TO "factura_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "factura" RENAME CONSTRAINT "Factura_userId_fkey" TO "factura_userId_fkey";

-- RenameForeignKey
ALTER TABLE "inventory" RENAME CONSTRAINT "Inventory_productId_fkey" TO "inventory_productId_fkey";

-- RenameForeignKey
ALTER TABLE "inventory" RENAME CONSTRAINT "Inventory_storeId_fkey" TO "inventory_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "inventory_snapshot" RENAME CONSTRAINT "InventorySnapshot_storeId_fkey" TO "inventory_snapshot_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "movement_reason" RENAME CONSTRAINT "MovementReason_storeId_fkey" TO "movement_reason_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "product" RENAME CONSTRAINT "Product_categoryId_fkey" TO "product_categoryId_fkey";

-- RenameForeignKey
ALTER TABLE "product" RENAME CONSTRAINT "Product_storeId_fkey" TO "product_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion" RENAME CONSTRAINT "Promotion_createdById_fkey" TO "promotion_createdById_fkey";

-- RenameForeignKey
ALTER TABLE "promotion" RENAME CONSTRAINT "Promotion_storeId_fkey" TO "promotion_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion_application" RENAME CONSTRAINT "PromotionApplication_productId_fkey" TO "promotion_application_productId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion_application" RENAME CONSTRAINT "PromotionApplication_promotionId_fkey" TO "promotion_application_promotionId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion_application" RENAME CONSTRAINT "PromotionApplication_saleId_fkey" TO "promotion_application_saleId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion_application" RENAME CONSTRAINT "PromotionApplication_storeId_fkey" TO "promotion_application_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion_item" RENAME CONSTRAINT "PromotionItem_categoryId_fkey" TO "promotion_item_categoryId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion_item" RENAME CONSTRAINT "PromotionItem_productId_fkey" TO "promotion_item_productId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion_item" RENAME CONSTRAINT "PromotionItem_promotionId_fkey" TO "promotion_item_promotionId_fkey";

-- RenameForeignKey
ALTER TABLE "revoked_token" RENAME CONSTRAINT "RevokedToken_userId_fkey" TO "revoked_token_userId_fkey";

-- RenameForeignKey
ALTER TABLE "sale" RENAME CONSTRAINT "Sale_cajaSessionId_fkey" TO "sale_cajaSessionId_fkey";

-- RenameForeignKey
ALTER TABLE "sale" RENAME CONSTRAINT "Sale_cancellationReasonId_fkey" TO "sale_cancellationReasonId_fkey";

-- RenameForeignKey
ALTER TABLE "sale" RENAME CONSTRAINT "Sale_clienteId_fkey" TO "sale_clienteId_fkey";

-- RenameForeignKey
ALTER TABLE "sale" RENAME CONSTRAINT "Sale_storeId_fkey" TO "sale_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "sale" RENAME CONSTRAINT "Sale_userId_fkey" TO "sale_userId_fkey";

-- RenameForeignKey
ALTER TABLE "sale_item" RENAME CONSTRAINT "SaleItem_cancellationId_fkey" TO "sale_item_cancellationId_fkey";

-- RenameForeignKey
ALTER TABLE "sale_item" RENAME CONSTRAINT "SaleItem_productId_fkey" TO "sale_item_productId_fkey";

-- RenameForeignKey
ALTER TABLE "sale_item" RENAME CONSTRAINT "SaleItem_saleId_fkey" TO "sale_item_saleId_fkey";

-- RenameForeignKey
ALTER TABLE "stock_movement" RENAME CONSTRAINT "StockMovement_productId_fkey" TO "stock_movement_productId_fkey";

-- RenameForeignKey
ALTER TABLE "stock_movement" RENAME CONSTRAINT "StockMovement_reasonId_fkey" TO "stock_movement_reasonId_fkey";

-- RenameForeignKey
ALTER TABLE "stock_movement" RENAME CONSTRAINT "StockMovement_storeId_fkey" TO "stock_movement_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "stock_movement" RENAME CONSTRAINT "StockMovement_userId_fkey" TO "stock_movement_userId_fkey";

-- RenameForeignKey
ALTER TABLE "supplier" RENAME CONSTRAINT "Supplier_storeId_fkey" TO "supplier_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "supplier_transaction" RENAME CONSTRAINT "SupplierTransaction_cajaSessionId_fkey" TO "supplier_transaction_cajaSessionId_fkey";

-- RenameForeignKey
ALTER TABLE "supplier_transaction" RENAME CONSTRAINT "SupplierTransaction_cancellationReasonId_fkey" TO "supplier_transaction_cancellationReasonId_fkey";

-- RenameForeignKey
ALTER TABLE "supplier_transaction" RENAME CONSTRAINT "SupplierTransaction_storeId_fkey" TO "supplier_transaction_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "supplier_transaction" RENAME CONSTRAINT "SupplierTransaction_supplierId_fkey" TO "supplier_transaction_supplierId_fkey";

-- RenameForeignKey
ALTER TABLE "supplier_transaction" RENAME CONSTRAINT "SupplierTransaction_userId_fkey" TO "supplier_transaction_userId_fkey";

-- RenameForeignKey
ALTER TABLE "supplier_transaction_item" RENAME CONSTRAINT "SupplierTransactionItem_productId_fkey" TO "supplier_transaction_item_productId_fkey";

-- RenameForeignKey
ALTER TABLE "supplier_transaction_item" RENAME CONSTRAINT "SupplierTransactionItem_transactionId_fkey" TO "supplier_transaction_item_transactionId_fkey";

-- RenameForeignKey
ALTER TABLE "ticket" RENAME CONSTRAINT "Ticket_assignedToSoporteId_fkey" TO "ticket_assignedToSoporteId_fkey";

-- RenameForeignKey
ALTER TABLE "ticket" RENAME CONSTRAINT "Ticket_storeId_fkey" TO "ticket_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "ticket" RENAME CONSTRAINT "Ticket_userId_fkey" TO "ticket_userId_fkey";

-- RenameForeignKey
ALTER TABLE "ticket_attachment" RENAME CONSTRAINT "TicketAttachment_ticketId_fkey" TO "ticket_attachment_ticketId_fkey";

-- RenameForeignKey
ALTER TABLE "ticket_comment" RENAME CONSTRAINT "TicketComment_ticketId_fkey" TO "ticket_comment_ticketId_fkey";

-- RenameForeignKey
ALTER TABLE "ticket_comment" RENAME CONSTRAINT "TicketComment_userId_fkey" TO "ticket_comment_userId_fkey";

-- RenameForeignKey
ALTER TABLE "ticket_config" RENAME CONSTRAINT "TicketConfig_storeId_fkey" TO "ticket_config_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "user_store" RENAME CONSTRAINT "UserStore_storeId_fkey" TO "user_store_storeId_fkey";

-- RenameForeignKey
ALTER TABLE "user_store" RENAME CONSTRAINT "UserStore_userId_fkey" TO "user_store_userId_fkey";

-- RenameIndex
ALTER INDEX "AuditLog_entity_entityId_idx" RENAME TO "audit_log_entity_entityId_idx";

-- RenameIndex
ALTER INDEX "AuditLog_storeId_createdAt_idx" RENAME TO "audit_log_storeId_createdAt_idx";

-- RenameIndex
ALTER INDEX "AuditLog_userId_idx" RENAME TO "audit_log_userId_idx";

-- RenameIndex
ALTER INDEX "Caja_assignedUserId_idx" RENAME TO "caja_assignedUserId_idx";

-- RenameIndex
ALTER INDEX "Caja_storeId_idx" RENAME TO "caja_storeId_idx";

-- RenameIndex
ALTER INDEX "Caja_storeId_name_key" RENAME TO "caja_storeId_name_key";

-- RenameIndex
ALTER INDEX "CajaAlert_cajaSessionId_idx" RENAME TO "caja_alert_cajaSessionId_idx";

-- RenameIndex
ALTER INDEX "CajaAlert_storeId_idx" RENAME TO "caja_alert_storeId_idx";

-- RenameIndex
ALTER INDEX "CajaAlert_triggeredAt_idx" RENAME TO "caja_alert_triggeredAt_idx";

-- RenameIndex
ALTER INDEX "CajaMovimiento_cajaSessionId_idx" RENAME TO "caja_movimiento_cajaSessionId_idx";

-- RenameIndex
ALTER INDEX "CajaMovimiento_storeId_idx" RENAME TO "caja_movimiento_storeId_idx";

-- RenameIndex
ALTER INDEX "CajaMovimiento_userId_idx" RENAME TO "caja_movimiento_userId_idx";

-- RenameIndex
ALTER INDEX "CajaMovimientoMotivo_storeId_idx" RENAME TO "caja_movimiento_motivo_storeId_idx";

-- RenameIndex
ALTER INDEX "CajaMovimientoMotivo_storeId_name_key" RENAME TO "caja_movimiento_motivo_storeId_name_key";

-- RenameIndex
ALTER INDEX "CajaMovimientoMotivo_tipo_idx" RENAME TO "caja_movimiento_motivo_tipo_idx";

-- RenameIndex
ALTER INDEX "CajaSession_cajaId_idx" RENAME TO "caja_session_cajaId_idx";

-- RenameIndex
ALTER INDEX "CajaSession_storeId_openingDate_idx" RENAME TO "caja_session_storeId_openingDate_idx";

-- RenameIndex
ALTER INDEX "CajaSession_storeId_status_idx" RENAME TO "caja_session_storeId_status_idx";

-- RenameIndex
ALTER INDEX "CajaSession_userId_idx" RENAME TO "caja_session_userId_idx";

-- RenameIndex
ALTER INDEX "Cancellation_cancellationReasonId_idx" RENAME TO "cancellation_cancellationReasonId_idx";

-- RenameIndex
ALTER INDEX "Cancellation_entityType_entityId_idx" RENAME TO "cancellation_entityType_entityId_idx";

-- RenameIndex
ALTER INDEX "Cancellation_storeId_createdAt_idx" RENAME TO "cancellation_storeId_createdAt_idx";

-- RenameIndex
ALTER INDEX "Cancellation_userId_idx" RENAME TO "cancellation_userId_idx";

-- RenameIndex
ALTER INDEX "CancellationItem_cancellationId_idx" RENAME TO "cancellation_item_cancellationId_idx";

-- RenameIndex
ALTER INDEX "CancellationItem_productId_idx" RENAME TO "cancellation_item_productId_idx";

-- RenameIndex
ALTER INDEX "CancellationItem_saleItemId_idx" RENAME TO "cancellation_item_saleItemId_idx";

-- RenameIndex
ALTER INDEX "CancellationItem_storeId_idx" RENAME TO "cancellation_item_storeId_idx";

-- RenameIndex
ALTER INDEX "CancellationReason_storeId_idx" RENAME TO "cancellation_reason_storeId_idx";

-- RenameIndex
ALTER INDEX "CancellationReason_storeId_name_key" RENAME TO "cancellation_reason_storeId_name_key";

-- RenameIndex
ALTER INDEX "Category_name_storeId_key" RENAME TO "category_name_storeId_key";

-- RenameIndex
ALTER INDEX "Cliente_storeId_nombreRazonSocial_idx" RENAME TO "cliente_storeId_nombreRazonSocial_idx";

-- RenameIndex
ALTER INDEX "Cliente_storeId_rfc_key" RENAME TO "cliente_storeId_rfc_key";

-- RenameIndex
ALTER INDEX "Factura_clienteId_idx" RENAME TO "factura_clienteId_idx";

-- RenameIndex
ALTER INDEX "Factura_folio_key" RENAME TO "factura_folio_key";

-- RenameIndex
ALTER INDEX "Factura_saleId_key" RENAME TO "factura_saleId_key";

-- RenameIndex
ALTER INDEX "Factura_storeId_createdAt_idx" RENAME TO "factura_storeId_createdAt_idx";

-- RenameIndex
ALTER INDEX "Factura_userId_idx" RENAME TO "factura_userId_idx";

-- RenameIndex
ALTER INDEX "Inventory_productId_idx" RENAME TO "inventory_productId_idx";

-- RenameIndex
ALTER INDEX "Inventory_storeId_productId_key" RENAME TO "inventory_storeId_productId_key";

-- RenameIndex
ALTER INDEX "InventorySnapshot_storeId_date_idx" RENAME TO "inventory_snapshot_storeId_date_idx";

-- RenameIndex
ALTER INDEX "InventorySnapshot_storeId_productId_date_key" RENAME TO "inventory_snapshot_storeId_productId_date_key";

-- RenameIndex
ALTER INDEX "MovementReason_storeId_idx" RENAME TO "movement_reason_storeId_idx";

-- RenameIndex
ALTER INDEX "MovementReason_storeId_name_key" RENAME TO "movement_reason_storeId_name_key";

-- RenameIndex
ALTER INDEX "Product_categoryId_idx" RENAME TO "product_categoryId_idx";

-- RenameIndex
ALTER INDEX "Product_sku_key" RENAME TO "product_sku_key";

-- RenameIndex
ALTER INDEX "Product_storeId_idx" RENAME TO "product_storeId_idx";

-- RenameIndex
ALTER INDEX "Promotion_storeId_isActive_idx" RENAME TO "promotion_storeId_isActive_idx";

-- RenameIndex
ALTER INDEX "Promotion_storeId_startsAt_endsAt_idx" RENAME TO "promotion_storeId_startsAt_endsAt_idx";

-- RenameIndex
ALTER INDEX "Promotion_type_idx" RENAME TO "promotion_type_idx";

-- RenameIndex
ALTER INDEX "PromotionApplication_productId_idx" RENAME TO "promotion_application_productId_idx";

-- RenameIndex
ALTER INDEX "PromotionApplication_promotionId_idx" RENAME TO "promotion_application_promotionId_idx";

-- RenameIndex
ALTER INDEX "PromotionApplication_saleId_idx" RENAME TO "promotion_application_saleId_idx";

-- RenameIndex
ALTER INDEX "PromotionApplication_storeId_createdAt_idx" RENAME TO "promotion_application_storeId_createdAt_idx";

-- RenameIndex
ALTER INDEX "PromotionItem_categoryId_idx" RENAME TO "promotion_item_categoryId_idx";

-- RenameIndex
ALTER INDEX "PromotionItem_productId_idx" RENAME TO "promotion_item_productId_idx";

-- RenameIndex
ALTER INDEX "PromotionItem_promotionId_categoryId_key" RENAME TO "promotion_item_promotionId_categoryId_key";

-- RenameIndex
ALTER INDEX "PromotionItem_promotionId_productId_key" RENAME TO "promotion_item_promotionId_productId_key";

-- RenameIndex
ALTER INDEX "RevokedToken_expiresAt_idx" RENAME TO "revoked_token_expiresAt_idx";

-- RenameIndex
ALTER INDEX "RevokedToken_tokenHash_key" RENAME TO "revoked_token_tokenHash_key";

-- RenameIndex
ALTER INDEX "RevokedToken_userId_idx" RENAME TO "revoked_token_userId_idx";

-- RenameIndex
ALTER INDEX "Sale_cajaSessionId_idx" RENAME TO "sale_cajaSessionId_idx";

-- RenameIndex
ALTER INDEX "Sale_clienteId_idx" RENAME TO "sale_clienteId_idx";

-- RenameIndex
ALTER INDEX "Sale_saleNumber_idx" RENAME TO "sale_saleNumber_idx";

-- RenameIndex
ALTER INDEX "Sale_saleNumber_key" RENAME TO "sale_saleNumber_key";

-- RenameIndex
ALTER INDEX "Sale_status_idx" RENAME TO "sale_status_idx";

-- RenameIndex
ALTER INDEX "Sale_storeId_createdAt_idx" RENAME TO "sale_storeId_createdAt_idx";

-- RenameIndex
ALTER INDEX "Sale_userId_idx" RENAME TO "sale_userId_idx";

-- RenameIndex
ALTER INDEX "SaleItem_productId_idx" RENAME TO "sale_item_productId_idx";

-- RenameIndex
ALTER INDEX "SaleItem_saleId_idx" RENAME TO "sale_item_saleId_idx";

-- RenameIndex
ALTER INDEX "StockMovement_batchId_idx" RENAME TO "stock_movement_batchId_idx";

-- RenameIndex
ALTER INDEX "StockMovement_productId_idx" RENAME TO "stock_movement_productId_idx";

-- RenameIndex
ALTER INDEX "StockMovement_reasonId_idx" RENAME TO "stock_movement_reasonId_idx";

-- RenameIndex
ALTER INDEX "StockMovement_referenceType_referenceId_idx" RENAME TO "stock_movement_referenceType_referenceId_idx";

-- RenameIndex
ALTER INDEX "StockMovement_storeId_createdAt_idx" RENAME TO "stock_movement_storeId_createdAt_idx";

-- RenameIndex
ALTER INDEX "StockMovement_userId_idx" RENAME TO "stock_movement_userId_idx";

-- RenameIndex
ALTER INDEX "Store_code_key" RENAME TO "store_code_key";

-- RenameIndex
ALTER INDEX "Supplier_storeId_idx" RENAME TO "supplier_storeId_idx";

-- RenameIndex
ALTER INDEX "SupplierTransaction_cajaSessionId_idx" RENAME TO "supplier_transaction_cajaSessionId_idx";

-- RenameIndex
ALTER INDEX "SupplierTransaction_paidFrom_idx" RENAME TO "supplier_transaction_paidFrom_idx";

-- RenameIndex
ALTER INDEX "SupplierTransaction_reference_key" RENAME TO "supplier_transaction_reference_key";

-- RenameIndex
ALTER INDEX "SupplierTransaction_storeId_createdAt_idx" RENAME TO "supplier_transaction_storeId_createdAt_idx";

-- RenameIndex
ALTER INDEX "SupplierTransaction_supplierId_idx" RENAME TO "supplier_transaction_supplierId_idx";

-- RenameIndex
ALTER INDEX "SupplierTransaction_userId_idx" RENAME TO "supplier_transaction_userId_idx";

-- RenameIndex
ALTER INDEX "SupplierTransactionItem_productId_idx" RENAME TO "supplier_transaction_item_productId_idx";

-- RenameIndex
ALTER INDEX "SupplierTransactionItem_transactionId_idx" RENAME TO "supplier_transaction_item_transactionId_idx";

-- RenameIndex
ALTER INDEX "Ticket_assignedToSoporteId_idx" RENAME TO "ticket_assignedToSoporteId_idx";

-- RenameIndex
ALTER INDEX "Ticket_folio_key" RENAME TO "ticket_folio_key";

-- RenameIndex
ALTER INDEX "Ticket_priority_idx" RENAME TO "ticket_priority_idx";

-- RenameIndex
ALTER INDEX "Ticket_status_idx" RENAME TO "ticket_status_idx";

-- RenameIndex
ALTER INDEX "Ticket_storeId_idx" RENAME TO "ticket_storeId_idx";

-- RenameIndex
ALTER INDEX "Ticket_ticketModule_idx" RENAME TO "ticket_ticketModule_idx";

-- RenameIndex
ALTER INDEX "Ticket_userId_idx" RENAME TO "ticket_userId_idx";

-- RenameIndex
ALTER INDEX "TicketAttachment_ticketId_idx" RENAME TO "ticket_attachment_ticketId_idx";

-- RenameIndex
ALTER INDEX "TicketComment_ticketId_idx" RENAME TO "ticket_comment_ticketId_idx";

-- RenameIndex
ALTER INDEX "TicketComment_userId_idx" RENAME TO "ticket_comment_userId_idx";

-- RenameIndex
ALTER INDEX "User_email_key" RENAME TO "user_email_key";

-- RenameIndex
ALTER INDEX "UserStore_storeId_idx" RENAME TO "user_store_storeId_idx";

-- RenameIndex
ALTER INDEX "UserStore_userId_isPrimary_idx" RENAME TO "user_store_userId_isPrimary_idx";

-- RenameIndex
ALTER INDEX "UserStore_userId_storeId_key" RENAME TO "user_store_userId_storeId_key";
