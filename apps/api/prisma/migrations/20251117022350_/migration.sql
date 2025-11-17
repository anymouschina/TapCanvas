-- CreateTable
CREATE TABLE "TaskTokenMapping" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTokenMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskStatus" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TaskStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskTokenMapping_userId_provider_idx" ON "TaskTokenMapping"("userId", "provider");

-- CreateIndex
CREATE INDEX "TaskTokenMapping_expiresAt_idx" ON "TaskTokenMapping"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTokenMapping_taskId_provider_key" ON "TaskTokenMapping"("taskId", "provider");

-- CreateIndex
CREATE INDEX "TaskStatus_status_idx" ON "TaskStatus"("status");

-- CreateIndex
CREATE INDEX "TaskStatus_createdAt_idx" ON "TaskStatus"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskStatus_taskId_provider_key" ON "TaskStatus"("taskId", "provider");

-- AddForeignKey
ALTER TABLE "TaskTokenMapping" ADD CONSTRAINT "TaskTokenMapping_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "ModelToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTokenMapping" ADD CONSTRAINT "TaskTokenMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
