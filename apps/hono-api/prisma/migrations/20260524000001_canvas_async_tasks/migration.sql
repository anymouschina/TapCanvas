-- Add chapter_id and node_id to task_results for canvas node association
ALTER TABLE "task_results" ADD COLUMN IF NOT EXISTS "chapter_id" TEXT;
ALTER TABLE "task_results" ADD COLUMN IF NOT EXISTS "node_id" TEXT;

-- Create asset_uris table for tapcanvas:// URI tracking
CREATE TABLE IF NOT EXISTS "asset_uris" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cdn_url" TEXT NOT NULL,
    "task_id" TEXT,
    "node_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "asset_uris_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_asset_uris_user" ON "asset_uris"("user_id");
CREATE INDEX IF NOT EXISTS "idx_asset_uris_task" ON "asset_uris"("task_id");

ALTER TABLE "asset_uris" ADD CONSTRAINT "asset_uris_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
