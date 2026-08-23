-- CreateEnum
CREATE TYPE "UnidadVenta" AS ENUM ('UNIDAD', 'PESO', 'VOLUMEN');

-- AlterTable
ALTER TABLE "Inventory" ALTER COLUMN "quantity" SET DEFAULT 0,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "presentacion" TEXT,
ADD COLUMN     "unidadVenta" "UnidadVenta" NOT NULL DEFAULT 'UNIDAD';

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "unidad" TEXT,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "SupplierTransactionItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

