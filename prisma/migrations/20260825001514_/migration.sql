-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Cancellation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CancellationItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CancellationReason" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Cliente" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Factura" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Inventory" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InventorySnapshot" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MovementReason" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RevokedToken" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Sale" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StockMovement" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Store" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SupplierTransaction" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SupplierTransactionItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;
