ALTER TABLE "agent_skills"
  ADD COLUMN IF NOT EXISTS "logo_url" TEXT,
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT '系统技能';

CREATE TABLE IF NOT EXISTS "user_skill_assets" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "content" TEXT NOT NULL,
  "logo_url" TEXT,
  "force_full_context" INTEGER NOT NULL DEFAULT 0,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "marketplace_product_id" TEXT,
  "marketplace_price_cents" INTEGER,
  "marketplace_currency" TEXT,
  "marketplace_listed_at" TEXT,
  "source_marketplace_product_id" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "user_skill_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_skill_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_skill_assets_owner_file" ON "user_skill_assets"("owner_id", "file_name");
CREATE INDEX IF NOT EXISTS "idx_user_skill_assets_owner_updated" ON "user_skill_assets"("owner_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_user_skill_assets_marketplace_product" ON "user_skill_assets"("marketplace_product_id");
CREATE INDEX IF NOT EXISTS "idx_user_skill_assets_source_product" ON "user_skill_assets"("source_marketplace_product_id");
