-- 修复生产库 schema 漂移。
--
-- 起因：线上手机号注册全挂——prisma.users.create() 报 “The column
-- `email_marketing_opt_out` does not exist”。老用户不走 create 故无感，只有新用户撞上。
--
-- 根因：_prisma_migrations 里 24 条迁移中有 22 条 applied_steps_count=0 且
-- started_at==finished_at，即被 `migrate resolve --applied` 批量标记为已应用但从未执行。
-- Prisma 因此认定它们已完成、永不重跑，而库里的表和列根本没建。生产库实为
-- db push/dump 产物 + 事后 baseline，与 schema.prisma 双向漂移。
--
-- 本迁移只做增量补齐，刻意排除 `migrate diff` 生成的全部破坏性操作：
--   * 9 个 DropTable —— 目标是 material_assets / storyboard_* / shot_material_refs，
--     这些表在产有真实数据，只是未被 schema.prisma 建模（走裸 SQL 管理）。删了即事故。
--   * 11 个 DropForeignKey、2 个 DropIndex —— schema 没声明不等于该删；
--     idx_projects_sort_weight / idx_team_memberships_user_id 删掉只伤性能，无收益。
--
-- 全部语句幂等（IF NOT EXISTS / DO 块兜 duplicate_object），故可安全重跑，
-- 且在全新库上与原始迁移叠加执行也不冲突。

-- AlterTable：补回被 baseline 跳过的 20260511000001_user_email_marketing_opt_out
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_marketing_opt_out" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "points_ledger" ADD COLUMN IF NOT EXISTS "api_key_id" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "active_workflow" TEXT NOT NULL DEFAULT 'free_canvas',
ADD COLUMN IF NOT EXISTS "channel_slug" TEXT,
ADD COLUMN IF NOT EXISTS "comment_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "cover_url" TEXT,
ADD COLUMN IF NOT EXISTS "description" TEXT,
ADD COLUMN IF NOT EXISTS "favorite_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "forked_from_project_id" TEXT,
ADD COLUMN IF NOT EXISTS "hot_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "like_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "published_at" TEXT,
ADD COLUMN IF NOT EXISTS "view_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "referral_config" ALTER COLUMN "id" SET DEFAULT 1,
ALTER COLUMN "recharge_credits_per_yuan" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "min_recharge_yuan_for_bonus" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "task_results" ADD COLUMN IF NOT EXISTS "chapter_id" TEXT,
ADD COLUMN IF NOT EXISTS "node_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "team_subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "price_monthly_cents" INTEGER NOT NULL DEFAULT 0,
    "price_annual_cents" INTEGER NOT NULL DEFAULT 0,
    "credits_per_seat_per_month" INTEGER NOT NULL DEFAULT 0,
    "max_seats" INTEGER NOT NULL DEFAULT 20,
    "min_seats" INTEGER NOT NULL DEFAULT 1,
    "features_json" TEXT,
    "sort_weight" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "team_subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "team_plan_subscriptions" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "seat_count" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_period_start" TEXT NOT NULL,
    "current_period_end" TEXT NOT NULL,
    "next_credit_renewal_at" TEXT NOT NULL,
    "last_renewed_at" TEXT,
    "credits_per_renewal" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "team_plan_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "last_response_id" TEXT,
    "last_sync_index" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_session_messages" (
    "session_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "message" JSONB NOT NULL,

    CONSTRAINT "agent_session_messages_pkey" PRIMARY KEY ("session_id","seq")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_lark_apps" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "app_secret" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'feishu',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_lark_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "content_channels" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "content_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_tags" (
    "project_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "project_tags_pkey" PRIMARY KEY ("project_id","tag_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_likes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "project_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_favorites" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "project_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_comments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "body" TEXT NOT NULL,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "deleted_at" TEXT,

    CONSTRAINT "project_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_follows" (
    "id" TEXT NOT NULL,
    "follower_id" TEXT NOT NULL,
    "following_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_profiles" (
    "user_id" TEXT NOT NULL,
    "bio" TEXT,
    "banner_url" TEXT,
    "links_json" TEXT,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "following_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_team_subscription_plans_enabled_sort" ON "team_subscription_plans"("enabled", "sort_weight");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_team_plan_subscriptions_team_status" ON "team_plan_subscriptions"("team_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_team_plan_subscriptions_renewal" ON "team_plan_subscriptions"("status", "next_credit_renewal_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_session_key_key" ON "agent_sessions"("session_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_sessions_user_id_idx" ON "agent_sessions"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_sessions_session_key_idx" ON "agent_sessions"("session_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_session_messages_session_id_idx" ON "agent_session_messages"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_lark_apps_user_id_key" ON "user_lark_apps"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_lark_apps_user_id_idx" ON "user_lark_apps"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_asset_uris_user" ON "asset_uris"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_asset_uris_task" ON "asset_uris"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_content_channels_slug" ON "content_channels"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_content_channels_enabled_sort" ON "content_channels"("enabled", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tags_name" ON "tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tags_slug" ON "tags"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_tags_tag" ON "project_tags"("tag_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_likes_user" ON "project_likes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_likes_unique" ON "project_likes"("project_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_favorites_user" ON "project_favorites"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_favorites_unique" ON "project_favorites"("project_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_comments_project" ON "project_comments"("project_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_project_comments_parent" ON "project_comments"("parent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_user_follows_following" ON "user_follows"("following_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_follows_unique" ON "user_follows"("follower_id", "following_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_points_ledger_api_key_created" ON "points_ledger"("api_key_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_projects_channel_hot" ON "projects"("channel_slug", "hot_score" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_projects_channel_published" ON "projects"("channel_slug", "published_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_projects_forked_from" ON "projects"("forked_from_project_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "team_plan_subscriptions" ADD CONSTRAINT "team_plan_subscriptions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "team_plan_subscriptions" ADD CONSTRAINT "team_plan_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "team_subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "agent_session_messages" ADD CONSTRAINT "agent_session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "asset_uris" ADD CONSTRAINT "asset_uris_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RenameIndex
DO $$ BEGIN
  ALTER INDEX "chapters_project_id_chapter_index_key" RENAME TO "idx_chapters_project_index_unique";
EXCEPTION
  -- ⚠️ PG 对「索引不存在」抛的是 undefined_table(42P01) 而非 undefined_object(42704)。
  -- 只接 undefined_object 会漏掉——本迁移曾因此在生产失败并触发 P3009 堵死全部后续部署。
  WHEN undefined_table THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

