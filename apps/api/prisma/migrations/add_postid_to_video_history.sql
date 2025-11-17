-- Add postId to VideoGenerationHistory for Sora remix support
ALTER TABLE "VideoGenerationHistory"
ADD COLUMN "postId" TEXT;

-- Create index for faster lookup
CREATE INDEX "VideoGenerationHistory_postId_idx" ON "VideoGenerationHistory"("postId");

-- Add comment
COMMENT ON COLUMN "VideoGenerationHistory"."postId" IS 'Published video ID (s_ prefix) used for Sora remix';