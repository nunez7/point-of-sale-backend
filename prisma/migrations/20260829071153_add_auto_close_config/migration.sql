-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "autoCloseDays" TEXT[] DEFAULT ARRAY['1', '2', '3', '4', '5', '6']::TEXT[],
ADD COLUMN     "autoCloseEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoCloseTime" TEXT;
