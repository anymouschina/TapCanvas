-- CreateTable
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

-- CreateIndex
CREATE INDEX "VideoGenerationHistory_userId_nodeId_idx" ON "VideoGenerationHistory"("userId", "nodeId");

-- CreateIndex
CREATE INDEX "VideoGenerationHistory_userId_projectId_idx" ON "VideoGenerationHistory"("userId", "projectId");

-- CreateIndex
CREATE INDEX "VideoGenerationHistory_status_idx" ON "VideoGenerationHistory"("status");

-- CreateIndex
CREATE INDEX "VideoGenerationHistory_createdAt_idx" ON "VideoGenerationHistory"("createdAt");

-- CreateIndex
CREATE INDEX "VideoGenerationHistory_isFavorite_idx" ON "VideoGenerationHistory"("isFavorite");

-- AddForeignKey
ALTER TABLE "VideoGenerationHistory" ADD CONSTRAINT "VideoGenerationHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoGenerationHistory" ADD CONSTRAINT "VideoGenerationHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
