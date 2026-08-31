-- 公众号扫码登录：会话表 + users 上的微信身份字段。
-- 与 Tanva 共用同一个公众号，但账号体系各自独立（同一微信在两边是两个账号），
-- 故这里的 open_id 只在本库唯一，不与 Tanva 的用户表关联。

CREATE TABLE IF NOT EXISTS "wechat_login_sessions" (
    "id" TEXT NOT NULL,
    "scene_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "qr_ticket" TEXT,
    "qr_code_url" TEXT,
    "open_id" TEXT,
    "union_id" TEXT,
    "nickname" TEXT,
    "avatar_url" TEXT,
    "user_id" TEXT,
    "return_to" TEXT,
    "authorized_at" TEXT,
    "consumed_at" TEXT,
    "expires_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "wechat_login_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_wechat_login_sessions_scene_key" ON "wechat_login_sessions"("scene_key");
CREATE INDEX IF NOT EXISTS "idx_wechat_login_sessions_expires_at" ON "wechat_login_sessions"("expires_at");
CREATE INDEX IF NOT EXISTS "idx_wechat_login_sessions_open_id" ON "wechat_login_sessions"("open_id");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wechat_official_open_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wechat_official_union_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_wechat_official_open_id" ON "users"("wechat_official_open_id");
