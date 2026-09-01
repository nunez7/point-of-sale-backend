-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('DIRECT_AMOUNT', 'PERCENTAGE', 'N_FOR_DISCOUNT', 'N_FOR_FREE', 'TIERED_BY_AMOUNT', 'COMBO', 'CATEGORY_PERCENTAGE');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "originalUnitPrice" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "config" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "weekdays" "Weekday"[],
    "timeFrom" TEXT,
    "timeTo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionItem" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "comboPrice" DECIMAL(12,2),

    CONSTRAINT "PromotionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionApplication" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT,
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "discountedAmount" DECIMAL(12,2) NOT NULL,
    "savedAmount" DECIMAL(12,2) NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_storeId_isActive_idx" ON "Promotion"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "Promotion_storeId_startsAt_endsAt_idx" ON "Promotion"("storeId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Promotion_type_idx" ON "Promotion"("type");

-- CreateIndex
CREATE INDEX "PromotionItem_productId_idx" ON "PromotionItem"("productId");

-- CreateIndex
CREATE INDEX "PromotionItem_categoryId_idx" ON "PromotionItem"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionItem_promotionId_productId_key" ON "PromotionItem"("promotionId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionItem_promotionId_categoryId_key" ON "PromotionItem"("promotionId", "categoryId");

-- CreateIndex
CREATE INDEX "PromotionApplication_storeId_createdAt_idx" ON "PromotionApplication"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionApplication_saleId_idx" ON "PromotionApplication"("saleId");

-- CreateIndex
CREATE INDEX "PromotionApplication_promotionId_idx" ON "PromotionApplication"("promotionId");

-- CreateIndex
CREATE INDEX "PromotionApplication_productId_idx" ON "PromotionApplication"("productId");

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionApplication" ADD CONSTRAINT "PromotionApplication_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionApplication" ADD CONSTRAINT "PromotionApplication_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionApplication" ADD CONSTRAINT "PromotionApplication_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionApplication" ADD CONSTRAINT "PromotionApplication_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
