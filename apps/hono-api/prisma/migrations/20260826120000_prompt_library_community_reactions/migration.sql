ALTER TABLE "prompt_library_entries"
  ADD COLUMN IF NOT EXISTS "community_like_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "community_comment_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "prompt_library_likes" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "prompt_library_likes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prompt_library_likes_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "prompt_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prompt_library_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_library_likes_entry_user" ON "prompt_library_likes"("entry_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_likes_entry" ON "prompt_library_likes"("entry_id");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_likes_user" ON "prompt_library_likes"("user_id");

CREATE TABLE IF NOT EXISTS "prompt_library_comments" (
  "id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "prompt_library_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prompt_library_comments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "prompt_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prompt_library_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_prompt_library_comments_entry_created" ON "prompt_library_comments"("entry_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_prompt_library_comments_user" ON "prompt_library_comments"("user_id");
