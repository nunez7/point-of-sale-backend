-- Agrega campos fiscales y de domicilio al proveedor.
ALTER TABLE "Supplier" ADD COLUMN "rfc" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "city" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "state" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "postalCode" TEXT;
