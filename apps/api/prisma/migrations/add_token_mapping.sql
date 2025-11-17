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
CREATE UNIQUE INDEX "TaskTokenMapping_taskId_provider_key" ON "TaskTokenMapping"("taskId", "provider");

-- CreateIndex
CREATE INDEX "TaskTokenMapping_userId_provider_idx" ON "TaskTokenMapping"("userId", "provider");

-- CreateIndex
CREATE INDEX "TaskTokenMapping_expiresAt_idx" ON "TaskTokenMapping"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskStatus_taskId_provider_key" ON "TaskStatus"("taskId", "provider");

-- CreateIndex
CREATE INDEX "TaskStatus_status_idx" ON "TaskStatus"("status");

-- CreateIndex
CREATE INDEX "TaskStatus_createdAt_idx" ON "TaskStatus"("createdAt");

-- AddForeignKey
ALTER TABLE "TaskTokenMapping" ADD CONSTRAINT "TaskTokenMapping_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "ModelToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTokenMapping" ADD CONSTRAINT "TaskTokenMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable for VideoGenerationHistory
CREATE TABLE "VideoGenerationHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "projectId" TEXT,
    "prompt" TEXT NOT NULL,
    "parameters" JSONB,
    "imageUrl" TEXT,
    "remixTargetId" TEXT,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "duration" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "tokenId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "cost" DOUBLE PRECISION,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoGenerationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for VideoGenerationHistory
CREATE INDEX "VideoGenerationHistory_userId_nodeId_idx" ON "VideoGenerationHistory"("userId", "nodeId");

CREATE INDEX "VideoGenerationHistory_userId_projectId_idx" ON "VideoGenerationHistory"("userId", "projectId");

CREATE INDEX "VideoGenerationHistory_status_idx" ON "VideoGenerationHistory"("status");

CREATE INDEX "VideoGenerationHistory_createdAt_idx" ON "VideoGenerationHistory"("createdAt");

CREATE INDEX "VideoGenerationHistory_isFavorite_idx" ON "VideoGenerationHistory"("isFavorite");

-- AddForeignKey for VideoGenerationHistory
ALTER TABLE "VideoGenerationHistory" ADD CONSTRAINT "VideoGenerationHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VideoGenerationHistory" ADD CONSTRAINT "VideoGenerationHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;