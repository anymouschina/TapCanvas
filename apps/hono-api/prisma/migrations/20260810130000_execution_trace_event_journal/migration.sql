-- Durable AI execution event journal.
--
-- The public chat request path must never create or alter tables. This
-- migration promotes the former runtime-created trace tables into an explicit
-- deploy contract and adds structural correlation plus producer idempotency.

CREATE TABLE IF NOT EXISTS "execution_traces" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "task_id" TEXT,
  "request_kind" TEXT NOT NULL,
  "input_summary" TEXT NOT NULL,
  "decision_log_json" TEXT,
  "tool_calls_json" TEXT,
  "meta_json" TEXT,
  "result_summary" TEXT,
  "error_code" TEXT,
  "error_detail" TEXT,
  "created_at" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'succeeded',
  "session_key" TEXT,
  "workflow_key" TEXT,
  "started_at" TEXT,
  "updated_at" TEXT,
  "finished_at" TEXT,
  "next_event_seq" BIGINT NOT NULL DEFAULT 0,
  "logical_task_id" TEXT,
  "root_trace_id" TEXT,
  "parent_trace_id" TEXT,
  "physical_run_id" TEXT,
  "workflow_run_id" TEXT
);

ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "meta_json" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "session_key" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "workflow_key" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "started_at" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "finished_at" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "next_event_seq" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "logical_task_id" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "root_trace_id" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "parent_trace_id" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "physical_run_id" TEXT;
ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "workflow_run_id" TEXT;

UPDATE "execution_traces"
SET "started_at" = COALESCE("started_at", "created_at"),
    "updated_at" = COALESCE("updated_at", "created_at"),
    "root_trace_id" = COALESCE("root_trace_id", "id"),
    "logical_task_id" = COALESCE("logical_task_id", "root_trace_id", "id");

ALTER TABLE "execution_traces" ALTER COLUMN "started_at" SET NOT NULL;
ALTER TABLE "execution_traces" ALTER COLUMN "updated_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_execution_traces_user_scope"
  ON "execution_traces" ("user_id", "scope_type", "scope_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_execution_traces_root_started"
  ON "execution_traces" ("user_id", "root_trace_id", "started_at" ASC);
CREATE INDEX IF NOT EXISTS "idx_execution_traces_logical_task"
  ON "execution_traces" ("user_id", "logical_task_id", "started_at" ASC);

CREATE TABLE IF NOT EXISTS "execution_trace_events" (
  "id" TEXT PRIMARY KEY,
  "trace_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "seq" BIGINT NOT NULL,
  "producer_event_id" TEXT,
  "event_type" TEXT NOT NULL,
  "event_class" TEXT,
  "event_key" TEXT NOT NULL,
  "phase" TEXT,
  "status" TEXT,
  "logical_task_id" TEXT,
  "root_trace_id" TEXT,
  "parent_trace_id" TEXT,
  "physical_run_id" TEXT,
  "workflow_run_id" TEXT,
  "workflow_node_id" TEXT,
  "agent_id" TEXT,
  "parent_agent_id" TEXT,
  "tool_call_id" TEXT,
  "effect_id" TEXT,
  "provider_task_id" TEXT,
  "span_id" TEXT,
  "parent_span_id" TEXT,
  "attempt" INTEGER,
  "payload_json" TEXT NOT NULL,
  "payload_size_bytes" INTEGER,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "execution_trace_events_trace_id_fkey"
    FOREIGN KEY ("trace_id") REFERENCES "execution_traces" ("id") ON DELETE CASCADE
);

ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "producer_event_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "event_class" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "logical_task_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "root_trace_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "parent_trace_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "physical_run_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "workflow_run_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "workflow_node_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "agent_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "parent_agent_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "tool_call_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "effect_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "provider_task_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "span_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "parent_span_id" TEXT;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "attempt" INTEGER;
ALTER TABLE "execution_trace_events" ADD COLUMN IF NOT EXISTS "payload_size_bytes" INTEGER;

UPDATE "execution_trace_events" AS event
SET "producer_event_id" = COALESCE(event."producer_event_id", 'legacy:' || event."seq"::text),
    "event_class" = COALESCE(event."event_class", 'diagnostic'),
    "root_trace_id" = COALESCE(event."root_trace_id", trace."root_trace_id", event."trace_id"),
    "logical_task_id" = COALESCE(event."logical_task_id", trace."logical_task_id", trace."root_trace_id", event."trace_id"),
    "parent_trace_id" = COALESCE(event."parent_trace_id", trace."parent_trace_id"),
    "physical_run_id" = COALESCE(event."physical_run_id", trace."physical_run_id"),
    "workflow_run_id" = COALESCE(event."workflow_run_id", trace."workflow_run_id"),
    "payload_size_bytes" = COALESCE(event."payload_size_bytes", octet_length(event."payload_json"))
FROM "execution_traces" AS trace
WHERE trace."id" = event."trace_id";

ALTER TABLE "execution_trace_events" ALTER COLUMN "producer_event_id" SET NOT NULL;
ALTER TABLE "execution_trace_events" ALTER COLUMN "event_class" SET NOT NULL;
ALTER TABLE "execution_trace_events" ALTER COLUMN "payload_size_bytes" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_execution_trace_events_trace_seq"
  ON "execution_trace_events" ("trace_id", "seq");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_execution_trace_events_trace_producer"
  ON "execution_trace_events" ("trace_id", "producer_event_id");
CREATE INDEX IF NOT EXISTS "idx_execution_trace_events_trace_seq"
  ON "execution_trace_events" ("trace_id", "seq" ASC);
CREATE INDEX IF NOT EXISTS "idx_execution_trace_events_user_created"
  ON "execution_trace_events" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_execution_trace_events_workflow_node"
  ON "execution_trace_events" ("workflow_run_id", "workflow_node_id", "seq" ASC);
CREATE INDEX IF NOT EXISTS "idx_execution_trace_events_tool_call"
  ON "execution_trace_events" ("tool_call_id", "seq" ASC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_execution_trace_events_attempt_positive'
  ) THEN
    ALTER TABLE "execution_trace_events"
      ADD CONSTRAINT "chk_execution_trace_events_attempt_positive"
      CHECK ("attempt" IS NULL OR "attempt" > 0);
  END IF;
END $$;
