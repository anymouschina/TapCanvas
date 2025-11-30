-- CreateTable
CREATE TABLE "PromptSample" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeKind" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "description" TEXT,
    "inputHint" TEXT,
    "outputNote" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromptSample_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PromptSample" ADD CONSTRAINT "PromptSample_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "PromptSample_userId_idx" ON "PromptSample"("userId");
CREATE INDEX "PromptSample_userId_nodeKind_idx" ON "PromptSample"("userId", "nodeKind");
