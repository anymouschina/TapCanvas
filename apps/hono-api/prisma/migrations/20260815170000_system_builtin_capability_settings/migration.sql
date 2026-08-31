CREATE TABLE IF NOT EXISTS "agent_builtin_capability_settings" (
  "capability_id" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "updated_by_user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,

  CONSTRAINT "agent_builtin_capability_settings_pkey" PRIMARY KEY ("capability_id"),
  CONSTRAINT "agent_builtin_capability_settings_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_agent_builtin_capability_settings_enabled"
  ON "agent_builtin_capability_settings"("enabled", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_agent_builtin_capability_settings_updated_by"
  ON "agent_builtin_capability_settings"("updated_by_user_id");
