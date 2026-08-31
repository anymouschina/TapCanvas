CREATE TABLE IF NOT EXISTS "prompt_library_entries" (
  "id" TEXT NOT NULL,
  "canonical_hash" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "prompt_text" TEXT NOT NULL,
  "prompt_text_original" TEXT,
  "media_type" TEXT NOT NULL,
  "author_label" TEXT NOT NULL DEFAULT '搜集自网络',
  "published_at" TEXT,
  "latest_source_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "prompt_library_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_library_entries_hash" ON "prompt_library_entries"("canonical_hash");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_entries_media_latest" ON "prompt_library_entries"("media_type", "latest_source_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_prompt_library_entries_updated" ON "prompt_library_entries"("updated_at" DESC);

CREATE TABLE IF NOT EXISTS "prompt_library_sources" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "source_site" TEXT NOT NULL,
  "source_prompt_id" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "source_author" TEXT,
  "source_author_url" TEXT,
  "original_language" TEXT,
  "model_slug" TEXT NOT NULL,
  "model_name" TEXT NOT NULL,
  "original_source_url" TEXT,
  "categories_json" TEXT,
  "like_count" INTEGER NOT NULL DEFAULT 0,
  "view_count" INTEGER NOT NULL DEFAULT 0,
  "share_count" INTEGER NOT NULL DEFAULT 0,
  "comment_count" INTEGER NOT NULL DEFAULT 0,
  "bookmark_count" INTEGER NOT NULL DEFAULT 0,
  "quote_count" INTEGER NOT NULL DEFAULT 0,
  "fetched_at" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "prompt_library_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prompt_library_sources_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "prompt_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_library_sources_url" ON "prompt_library_sources"("source_url");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_sources_entry" ON "prompt_library_sources"("entry_id");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_sources_model_fetched" ON "prompt_library_sources"("model_slug", "fetched_at" DESC);

CREATE TABLE IF NOT EXISTS "prompt_library_models" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "model_slug" TEXT NOT NULL,
  "model_name" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "prompt_library_models_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prompt_library_models_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "prompt_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_library_models_entry_slug" ON "prompt_library_models"("entry_id", "model_slug");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_models_slug" ON "prompt_library_models"("model_slug");

CREATE TABLE IF NOT EXISTS "prompt_library_media" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "source_id" TEXT,
  "media_kind" TEXT NOT NULL,
  "media_url" TEXT NOT NULL,
  "thumbnail_url" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "prompt_library_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prompt_library_media_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "prompt_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prompt_library_media_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "prompt_library_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_library_media_entry_url" ON "prompt_library_media"("entry_id", "media_url");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_media_entry_order" ON "prompt_library_media"("entry_id", "sort_order");

CREATE TABLE IF NOT EXISTS "prompt_library_crawl_runs" (
  "id" TEXT NOT NULL,
  "target_site" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "discovered_count" INTEGER NOT NULL DEFAULT 0,
  "processed_count" INTEGER NOT NULL DEFAULT 0,
  "imported_count" INTEGER NOT NULL DEFAULT 0,
  "deduplicated_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "current_url" TEXT,
  "error_message" TEXT,
  "started_at" TEXT,
  "finished_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "prompt_library_crawl_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_prompt_library_crawl_runs_status_created" ON "prompt_library_crawl_runs"("status", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "prompt_library_crawl_targets" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "source_prompt_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "entry_id" TEXT,
  "error_message" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "prompt_library_crawl_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prompt_library_crawl_targets_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "prompt_library_crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_library_crawl_targets_run_url" ON "prompt_library_crawl_targets"("run_id", "source_url");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_crawl_targets_run_status" ON "prompt_library_crawl_targets"("run_id", "status", "created_at");
