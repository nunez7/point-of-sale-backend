-- CreateTable
CREATE TABLE "RevokedToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevokedToken_tokenHash_key" ON "RevokedToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "RevokedToken" ADD CONSTRAINT "RevokedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
