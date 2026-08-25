/*
  Warnings:

  - Changed the default value of the `id` column from `cuid()` to `uuid()` on all remaining models.
  - Forward-only: existing rows keep their `cuid` value (valid text); new rows get a UUID v4.
*/

ALTER TABLE "CancellationReason" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Store" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "RevokedToken" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Category" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Product" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Inventory" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "MovementReason" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "StockMovement" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "InventorySnapshot" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Sale" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "SaleItem" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Supplier" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "SupplierTransactionItem" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "AuditLog" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Cliente" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "CancellationItem" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
