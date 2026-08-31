-- Deploying this migration with the sid hard cutover invalidates previously
-- issued stateless JWTs. Existing users must sign in again once.
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_label" TEXT NOT NULL,
    "user_agent" TEXT,
    "network_hash" TEXT,
    "created_at" TEXT NOT NULL,
    "last_seen_at" TEXT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "revoked_at" TEXT,
    "revoked_reason" TEXT,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action_url" TEXT,
    "metadata_json" TEXT,
    "read_at" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_auth_sessions_user_last_seen" ON "auth_sessions"("user_id", "last_seen_at" DESC);
CREATE INDEX "idx_auth_sessions_user_active" ON "auth_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "idx_auth_sessions_expires" ON "auth_sessions"("expires_at");
CREATE INDEX "idx_user_notifications_user_created" ON "user_notifications"("user_id", "created_at" DESC);
CREATE INDEX "idx_user_notifications_user_read_created" ON "user_notifications"("user_id", "read_at", "created_at" DESC);

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
