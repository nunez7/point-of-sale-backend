/*
  Warnings:

  - Changed the default value of the `id` column in `Factura`, `SupplierTransaction` and `Cancellation` from `cuid()` to `uuid()`.
  - Existing rows keep their `cuid` value (forward-only). New rows get a UUID v4.
*/

ALTER TABLE "Factura" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "SupplierTransaction" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "Cancellation" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
