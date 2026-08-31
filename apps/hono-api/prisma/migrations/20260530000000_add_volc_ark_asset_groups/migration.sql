-- CreateTable: ARK 内容审核素材组追踪（供定时任务清理）。
-- 用 IF NOT EXISTS 保证幂等：本地可能已手动建过，生产首次由本 migration 创建。
CREATE TABLE IF NOT EXISTS "volc_ark_asset_groups" (
    "group_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "volc_ark_asset_groups_pkey" PRIMARY KEY ("group_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "volc_ark_asset_groups_created_at_idx" ON "volc_ark_asset_groups"("created_at");
