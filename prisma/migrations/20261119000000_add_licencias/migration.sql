-- CreateEnum
CREATE TYPE "license_status" AS ENUM ('ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'REVOKED');

-- CreateTable
CREATE TABLE "installation" (
    "id" TEXT NOT NULL,
    "machineId" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "licenseToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_license" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "folio" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'PRO',
    "maxCajas" INTEGER NOT NULL DEFAULT 1,
    "issuedTo" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 15,
    "status" "license_status" NOT NULL DEFAULT 'ACTIVE',
    "token" TEXT,
    "tokenHash" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_license_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caja_license" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeLicenseId" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "license_status" NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caja_license_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_event" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "storeLicenseId" TEXT,
    "tipo" TEXT NOT NULL,
    "mensaje" TEXT,
    "metadata" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_license_storeId_key" ON "store_license"("storeId");

-- CreateIndex
CREATE INDEX "store_license_expiresAt_idx" ON "store_license"("expiresAt");

-- CreateIndex
CREATE INDEX "store_license_status_idx" ON "store_license"("status");

-- CreateIndex
CREATE UNIQUE INDEX "caja_license_cajaId_key" ON "caja_license"("cajaId");

-- CreateIndex
CREATE INDEX "caja_license_storeId_idx" ON "caja_license"("storeId");

-- CreateIndex
CREATE INDEX "caja_license_storeLicenseId_idx" ON "caja_license"("storeLicenseId");

-- CreateIndex
CREATE INDEX "license_event_storeLicenseId_createdAt_idx" ON "license_event"("storeLicenseId", "createdAt");

-- CreateIndex
CREATE INDEX "license_event_storeId_createdAt_idx" ON "license_event"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "license_event_tipo_idx" ON "license_event"("tipo");

-- AddForeignKey
ALTER TABLE "store_license" ADD CONSTRAINT "store_license_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_license" ADD CONSTRAINT "caja_license_storeLicenseId_fkey" FOREIGN KEY ("storeLicenseId") REFERENCES "store_license"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_license" ADD CONSTRAINT "caja_license_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "caja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_event" ADD CONSTRAINT "license_event_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_event" ADD CONSTRAINT "license_event_storeLicenseId_fkey" FOREIGN KEY ("storeLicenseId") REFERENCES "store_license"("id") ON DELETE SET NULL ON UPDATE CASCADE;
