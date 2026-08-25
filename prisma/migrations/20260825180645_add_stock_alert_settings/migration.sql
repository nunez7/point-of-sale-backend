-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "notifyLowStock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyOutOfStock" BOOLEAN NOT NULL DEFAULT true;
