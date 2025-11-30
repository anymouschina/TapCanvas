-- AlterTable
ALTER TABLE "TaskStatus" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "ProxyProvider" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledVendors" TEXT[],
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProxyProvider_ownerId_vendor_idx" ON "ProxyProvider"("ownerId", "vendor");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyProvider_ownerId_vendor_key" ON "ProxyProvider"("ownerId", "vendor");

-- CreateIndex
CREATE INDEX "TaskStatus_userId_provider_idx" ON "TaskStatus"("userId", "provider");

-- AddForeignKey
ALTER TABLE "ProxyProvider" ADD CONSTRAINT "ProxyProvider_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStatus" ADD CONSTRAINT "TaskStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
