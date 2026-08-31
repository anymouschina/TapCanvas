CREATE TABLE IF NOT EXISTS "user_lark_apps" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "user_id"    TEXT NOT NULL,
  "app_id"     TEXT NOT NULL,
  "app_secret" TEXT NOT NULL,
  "brand"      TEXT NOT NULL DEFAULT 'feishu',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_lark_apps_user_id_key" ON "user_lark_apps"("user_id");
