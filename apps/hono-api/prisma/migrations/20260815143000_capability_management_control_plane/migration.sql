ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "project_kind" TEXT NOT NULL DEFAULT 'creative';

ALTER TABLE "agent_capability_attachments"
  ADD COLUMN IF NOT EXISTS "route_decisions_json" TEXT;

UPDATE "agent_capability_attachments"
SET "conflict_report_json" = (
  SELECT jsonb_set(
    "conflict_report_json"::jsonb,
    '{conflicts}',
    COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN conflict ? 'resolutionMode' THEN conflict
          WHEN conflict->>'category' = 'version_change' OR conflict->>'severity' = 'info'
            THEN conflict || '{"resolutionMode":"acknowledge"}'::jsonb
          ELSE conflict || '{"resolutionMode":"choose_primary"}'::jsonb
        END
        ORDER BY ordinal
      )
      FROM jsonb_array_elements("conflict_report_json"::jsonb->'conflicts') WITH ORDINALITY AS items(conflict, ordinal)
    ), '[]'::jsonb)
  )::text
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements("conflict_report_json"::jsonb->'conflicts') AS conflict
  WHERE NOT (conflict ? 'resolutionMode')
);

CREATE INDEX IF NOT EXISTS "idx_projects_owner_kind_updated"
  ON "projects"("owner_id", "project_kind", "updated_at" DESC);

CREATE TABLE IF NOT EXISTS "agent_capability_preferences" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "capability_kind" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "disabled_reason" TEXT,
  "replaced_by_capability_id" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,

  CONSTRAINT "agent_capability_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_capability_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_capability_preferences_user_capability"
  ON "agent_capability_preferences"("user_id", "capability_kind", "capability_id");

CREATE INDEX IF NOT EXISTS "idx_agent_capability_preferences_user_enabled"
  ON "agent_capability_preferences"("user_id", "enabled", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_agent_capability_preferences_replaced_by"
  ON "agent_capability_preferences"("replaced_by_capability_id");

CREATE TABLE IF NOT EXISTS "agent_capability_invocations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "attachment_id" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "capability_name" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "source_version_id" TEXT NOT NULL,
  "descriptor_sha256" TEXT NOT NULL,
  "workflow_execution_id" TEXT NOT NULL,
  "agent_execution_id" TEXT,
  "session_id" TEXT,
  "tool_call_id" TEXT,
  "input_json" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,

  CONSTRAINT "agent_capability_invocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_capability_invocations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "agent_capability_invocations_workflow_execution_id_fkey"
    FOREIGN KEY ("workflow_execution_id") REFERENCES "workflow_executions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_capability_invocations_execution"
  ON "agent_capability_invocations"("workflow_execution_id");

CREATE INDEX IF NOT EXISTS "idx_agent_capability_invocations_user_created"
  ON "agent_capability_invocations"("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_agent_capability_invocations_attachment_created"
  ON "agent_capability_invocations"("attachment_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_agent_capability_invocations_agent_execution"
  ON "agent_capability_invocations"("agent_execution_id");

CREATE INDEX IF NOT EXISTS "idx_agent_capability_invocations_session"
  ON "agent_capability_invocations"("session_id");
