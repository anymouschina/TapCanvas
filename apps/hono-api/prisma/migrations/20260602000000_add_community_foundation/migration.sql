-- Community foundation (P1): social counters on projects + channels/tags/likes/favorites/comments/follows/profiles
-- All statements idempotent; purely additive, never drops existing tables/columns.

-- 1) projects: denormalized social columns
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "channel_slug" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cover_url" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "published_at" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "view_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "like_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "favorite_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "comment_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "hot_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "forked_from_project_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_projects_channel_hot" ON "projects"("channel_slug", "hot_score" DESC);
CREATE INDEX IF NOT EXISTS "idx_projects_channel_published" ON "projects"("channel_slug", "published_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_projects_forked_from" ON "projects"("forked_from_project_id");

-- 2) content_channels
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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_content_channels_slug" ON "content_channels"("slug");
CREATE INDEX IF NOT EXISTS "idx_content_channels_enabled_sort" ON "content_channels"("enabled", "sort_order");

-- 3) tags
CREATE TABLE IF NOT EXISTS "tags" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tags_name" ON "tags"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tags_slug" ON "tags"("slug");

-- 4) project_tags
CREATE TABLE IF NOT EXISTS "project_tags" (
  "project_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  CONSTRAINT "project_tags_pkey" PRIMARY KEY ("project_id", "tag_id")
);
CREATE INDEX IF NOT EXISTS "idx_project_tags_tag" ON "project_tags"("tag_id");

-- 5) project_likes
CREATE TABLE IF NOT EXISTS "project_likes" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "project_likes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_likes_unique" ON "project_likes"("project_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_project_likes_user" ON "project_likes"("user_id");

-- 6) project_favorites
CREATE TABLE IF NOT EXISTS "project_favorites" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "project_favorites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_favorites_unique" ON "project_favorites"("project_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_project_favorites_user" ON "project_favorites"("user_id");

-- 7) project_comments
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
CREATE INDEX IF NOT EXISTS "idx_project_comments_project" ON "project_comments"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_project_comments_parent" ON "project_comments"("parent_id");

-- 8) user_follows
CREATE TABLE IF NOT EXISTS "user_follows" (
  "id" TEXT NOT NULL,
  "follower_id" TEXT NOT NULL,
  "following_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_follows_unique" ON "user_follows"("follower_id", "following_id");
CREATE INDEX IF NOT EXISTS "idx_user_follows_following" ON "user_follows"("following_id");

-- 9) user_profiles
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
