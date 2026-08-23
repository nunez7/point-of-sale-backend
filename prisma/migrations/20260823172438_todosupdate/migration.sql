/*
  Warnings:

  - Added the required column `total` to the `Cancellation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Cancellation" ADD COLUMN     "total" DECIMAL(12,2) NOT NULL;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;
