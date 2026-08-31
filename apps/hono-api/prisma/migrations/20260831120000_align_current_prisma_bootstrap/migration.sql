-- Additive, idempotent alignment for databases created from schema.sql before
-- the current Prisma contract. This migration is also executed explicitly by
-- migrate-deploy.mjs when a non-empty database is baselined.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "generation_prefs" TEXT,
  ADD COLUMN IF NOT EXISTS "wechat_official_open_id" TEXT,
  ADD COLUMN IF NOT EXISTS "wechat_official_union_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_wechat_official_open_id"
  ON "users"("wechat_official_open_id");

ALTER TABLE "teams"
  ADD COLUMN IF NOT EXISTS "max_members" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "flows"
  ADD COLUMN IF NOT EXISTS "canvas_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "agent_capability_attachments"
  ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'current_user';

CREATE INDEX IF NOT EXISTS "idx_agent_capability_attachments_scope"
  ON "agent_capability_attachments"("scope");

CREATE TABLE IF NOT EXISTS "agent_sessions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "session_key" TEXT NOT NULL,
  "last_response_id" TEXT,
  "last_sync_index" INTEGER NOT NULL DEFAULT 0,
  "meta" JSONB,
  "history_snapshot" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "agent_sessions"
  ADD COLUMN IF NOT EXISTS "meta" JSONB,
  ADD COLUMN IF NOT EXISTS "history_snapshot" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_session_key_key"
  ON "agent_sessions"("session_key");
CREATE INDEX IF NOT EXISTS "agent_sessions_user_id_idx"
  ON "agent_sessions"("user_id");
CREATE INDEX IF NOT EXISTS "agent_sessions_session_key_idx"
  ON "agent_sessions"("session_key");

CREATE TABLE IF NOT EXISTS "agent_session_messages" (
  "session_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "message" JSONB NOT NULL,
  PRIMARY KEY ("session_id", "seq"),
  FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "agent_session_messages_session_id_idx"
  ON "agent_session_messages"("session_id");

ALTER TABLE "api_keys"
  ADD COLUMN IF NOT EXISTS "billing_team_id" TEXT,
  ADD COLUMN IF NOT EXISTS "scopes" TEXT NOT NULL DEFAULT '["public:read"]',
  ADD COLUMN IF NOT EXISTS "expires_at" TEXT,
  ADD COLUMN IF NOT EXISTS "revoked_at" TEXT,
  ADD COLUMN IF NOT EXISTS "rotated_from_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_api_keys_owner_expires"
  ON "api_keys"("owner_id", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_api_keys_rotated_from"
  ON "api_keys"("rotated_from_id");

CREATE TABLE IF NOT EXISTS "skill_favorites" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "skill_key" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_skill_favorites_user_skill"
  ON "skill_favorites"("user_id", "skill_key");
CREATE INDEX IF NOT EXISTS "idx_skill_favorites_user_created"
  ON "skill_favorites"("user_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "wechat_login_sessions" (
  "id" TEXT PRIMARY KEY,
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
  "updated_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_wechat_login_sessions_scene_key"
  ON "wechat_login_sessions"("scene_key");
CREATE INDEX IF NOT EXISTS "idx_wechat_login_sessions_expires_at"
  ON "wechat_login_sessions"("expires_at");
CREATE INDEX IF NOT EXISTS "idx_wechat_login_sessions_open_id"
  ON "wechat_login_sessions"("open_id");

CREATE TABLE IF NOT EXISTS "team_subscription_fulfillments" (
  "order_id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "status" TEXT NOT NULL,
  "result_json" TEXT,
  "error_message" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "applied_at" TEXT
);

CREATE INDEX IF NOT EXISTS "idx_team_subscription_fulfillments_team_created"
  ON "team_subscription_fulfillments"("team_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_team_subscription_fulfillments_status_updated"
  ON "team_subscription_fulfillments"("status", "updated_at");

CREATE TABLE IF NOT EXISTS "team_project_shares" (
  "project_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "access" TEXT NOT NULL DEFAULT 'edit',
  "shared_by_user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("project_id", "team_id"),
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY ("team_id") REFERENCES "teams"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_team_project_shares_team"
  ON "team_project_shares"("team_id", "updated_at");

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "device_label" TEXT NOT NULL,
  "user_agent" TEXT,
  "network_hash" TEXT,
  "created_at" TEXT NOT NULL,
  "last_seen_at" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "revoked_at" TEXT,
  "revoked_reason" TEXT,
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_auth_sessions_user_last_seen"
  ON "auth_sessions"("user_id", "last_seen_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_user_active"
  ON "auth_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_expires"
  ON "auth_sessions"("expires_at");

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "action_url" TEXT,
  "metadata_json" TEXT,
  "read_at" TEXT,
  "created_at" TEXT NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_user_notifications_user_created"
  ON "user_notifications"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_user_notifications_user_read_created"
  ON "user_notifications"("user_id", "read_at", "created_at" DESC);

ALTER TABLE "workflow_executions"
  ADD COLUMN IF NOT EXISTS "error_code" TEXT,
  ADD COLUMN IF NOT EXISTS "failure_stage" TEXT,
  ADD COLUMN IF NOT EXISTS "project_id" TEXT,
  ADD COLUMN IF NOT EXISTS "canvas_id" TEXT,
  ADD COLUMN IF NOT EXISTS "user_input" TEXT,
  ADD COLUMN IF NOT EXISTS "project_context" TEXT,
  ADD COLUMN IF NOT EXISTS "asset_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recovery_of_execution_id" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_family_id" TEXT,
  ADD COLUMN IF NOT EXISTS "uses_project_assets" BOOLEAN NOT NULL DEFAULT false;

WITH RECURSIVE execution_families AS (
  SELECT execution."id", execution."id" AS family_id
  FROM "workflow_executions" AS execution
  WHERE execution."recovery_of_execution_id" IS NULL
  UNION ALL
  SELECT child."id", parent.family_id
  FROM "workflow_executions" AS child
  JOIN execution_families AS parent
    ON child."recovery_of_execution_id" = parent."id"
)
UPDATE "workflow_executions" AS execution
SET "execution_family_id" = family.family_id
FROM execution_families AS family
WHERE execution."id" = family."id"
  AND execution."execution_family_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "workflow_executions"
    WHERE "execution_family_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'workflow execution family alignment failed: orphaned or cyclic recovery ancestry';
  END IF;
END $$;

ALTER TABLE "workflow_executions"
  ALTER COLUMN "execution_family_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_workflow_executions_project_id"
  ON "workflow_executions"("project_id");
CREATE INDEX IF NOT EXISTS "idx_workflow_executions_recovery_of"
  ON "workflow_executions"("recovery_of_execution_id");
CREATE INDEX IF NOT EXISTS "idx_workflow_executions_family_created"
  ON "workflow_executions"("execution_family_id", "created_at", "id");

ALTER TABLE "workflow_node_runs"
  ADD COLUMN IF NOT EXISTS "error_code" TEXT,
  ADD COLUMN IF NOT EXISTS "failure_stage" TEXT,
  ADD COLUMN IF NOT EXISTS "input_refs" TEXT,
  ADD COLUMN IF NOT EXISTS "tool_calls" TEXT,
  ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "node_type" TEXT,
  ADD COLUMN IF NOT EXISTS "tool_name" TEXT,
  ADD COLUMN IF NOT EXISTS "model_key" TEXT;

CREATE TABLE IF NOT EXISTS "workflow_node_attempts" (
  "id" TEXT PRIMARY KEY,
  "execution_family_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "node_run_id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL CHECK ("attempt" > 0),
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('initial', 'recovery_execution', 'runtime_recovery', 'automatic_retry', 'manual_repair')),
  "status" TEXT NOT NULL CHECK ("status" IN ('pending', 'queued', 'running', 'waiting_external', 'success', 'failed', 'canceled', 'skipped', 'not_selected')),
  "semantics_snapshot" TEXT NOT NULL,
  "input_refs" TEXT,
  "output_refs" TEXT,
  "tool_calls" TEXT,
  "provider_receipts" TEXT,
  "token_usage" TEXT,
  "credit_usage" TEXT,
  "error_message" TEXT,
  "error_code" TEXT,
  "failure_stage" TEXT,
  "node_type" TEXT,
  "tool_name" TEXT,
  "model_key" TEXT,
  "created_at" TEXT NOT NULL,
  "started_at" TEXT,
  "finished_at" TEXT,
  FOREIGN KEY ("execution_id") REFERENCES "workflow_executions"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("node_run_id") REFERENCES "workflow_node_runs"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_workflow_node_attempts_run_attempt"
  ON "workflow_node_attempts"("node_run_id", "attempt");
CREATE INDEX IF NOT EXISTS "idx_workflow_node_attempts_family_created"
  ON "workflow_node_attempts"("execution_family_id", "created_at", "id");
CREATE INDEX IF NOT EXISTS "idx_workflow_node_attempts_execution_node"
  ON "workflow_node_attempts"("execution_id", "node_id", "attempt");
CREATE INDEX IF NOT EXISTS "idx_workflow_node_attempts_provider_receipts"
  ON "workflow_node_attempts"("execution_family_id")
  WHERE "provider_receipts" IS NOT NULL;
