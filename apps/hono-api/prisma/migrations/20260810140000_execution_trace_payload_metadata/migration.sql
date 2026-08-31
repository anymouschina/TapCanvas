-- Operational indexes and explicit payload truncation evidence for the AI event journal.

ALTER TABLE "execution_trace_events"
  ADD COLUMN IF NOT EXISTS "payload_truncated" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "idx_execution_traces_user_status_updated"
  ON "execution_traces" ("user_id", "status", "updated_at" ASC);

CREATE INDEX IF NOT EXISTS "idx_execution_traces_parent"
  ON "execution_traces" ("user_id", "parent_trace_id");
