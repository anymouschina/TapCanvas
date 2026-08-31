-- One-click production reliability kernel.
--
-- These tables are additive. Existing run, authoring artifact, provider task,
-- asset and delivery facts remain untouched. Effect revisions are immutable
-- identities; the row only projects that revision's monotonic lifecycle while
-- production_workflow_events retains the append-only transition history.

CREATE TABLE IF NOT EXISTS "production_effects" (
  "id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "workflow_node_id" TEXT NOT NULL CHECK ("workflow_node_id" IN (
    'production-contract',
    'story-adaptation',
    'clip-contracts',
    'asset-preparation',
    'media-production',
    'composition',
    'delivery'
  )),
  "effect_key" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "operation" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved' CHECK ("status" IN (
    'reserved',
    'submitting',
    'accepted',
    'materialized',
    'rejected_pre_upstream',
    'uncertain',
    'failed',
    'cancelled'
  )),
  "provider" TEXT,
  "provider_task_id" TEXT,
  "provider_receipt" TEXT,
  "asset_url" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "accepted_at" TEXT,
  "materialized_at" TEXT,
  "finished_at" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_production_effects_run_key_revision"
  ON "production_effects" ("run_id", "effect_key", "revision");
CREATE INDEX IF NOT EXISTS "idx_production_effects_run_node_status"
  ON "production_effects" ("run_id", "workflow_node_id", "status");
CREATE INDEX IF NOT EXISTS "idx_production_effects_provider_task"
  ON "production_effects" ("provider", "provider_task_id");

CREATE TABLE IF NOT EXISTS "production_workflow_events" (
  "id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL CHECK ("seq" > 0),
  "workflow_node_id" TEXT NOT NULL CHECK ("workflow_node_id" IN (
    'production-contract',
    'story-adaptation',
    'clip-contracts',
    'asset-preparation',
    'media-production',
    'composition',
    'delivery'
  )),
  "event_kind" TEXT NOT NULL CHECK ("event_kind" IN (
    'agent_turn',
    'tool_call',
    'effect',
    'artifact',
    'diagnostic',
    'status'
  )),
  "payload_ref" TEXT,
  "artifact_ids" TEXT NOT NULL DEFAULT '[]',
  "effect_ids" TEXT NOT NULL DEFAULT '[]',
  "created_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_production_workflow_events_run_seq"
  ON "production_workflow_events" ("run_id", "seq");
CREATE INDEX IF NOT EXISTS "idx_production_workflow_events_run_node_seq"
  ON "production_workflow_events" ("run_id", "workflow_node_id", "seq");

-- Promote pre-ledger durable submission facts. No authoring_artifacts row is
-- changed; this creates a first-class effect identity for recovery and audit.
INSERT INTO "production_effects" (
  "id", "run_id", "workflow_node_id", "effect_key", "revision",
  "operation", "input_hash", "status", "provider", "provider_task_id",
  "provider_receipt", "error_code", "error_message", "created_at",
  "updated_at", "accepted_at", "finished_at"
)
SELECT
  gen_random_uuid()::text,
  artifact."run_id",
  'media-production',
  'video-clip:' || split_part(artifact."artifact_key", ':', 2),
  GREATEST(COALESCE(NULLIF(artifact."payload"::jsonb ->> 'attempt', '')::integer, 0) + 1, 1),
  'video.generate',
  artifact."content_hash",
  CASE
    WHEN artifact."payload"::jsonb ->> 'kind' = 'provider_task_accepted' THEN 'accepted'
    WHEN artifact."payload"::jsonb ->> 'kind' = 'upstream_submission_uncertain' THEN 'uncertain'
    WHEN artifact."payload"::jsonb ->> 'kind' = 'structured_pre_upstream_rejection' THEN 'rejected_pre_upstream'
    WHEN artifact."status" = 'pending' THEN 'reserved'
    ELSE 'uncertain'
  END,
  NULLIF(artifact."payload"::jsonb ->> 'vendor', ''),
  NULLIF(artifact."payload"::jsonb ->> 'taskId', ''),
  artifact."payload",
  NULLIF(artifact."payload"::jsonb ->> 'errorCode', ''),
  COALESCE(NULLIF(artifact."payload"::jsonb ->> 'errorMessage', ''), artifact."error"),
  artifact."created_at",
  artifact."updated_at",
  CASE WHEN artifact."payload"::jsonb ->> 'kind' = 'provider_task_accepted' THEN artifact."updated_at" ELSE NULL END,
  CASE WHEN artifact."payload"::jsonb ->> 'kind' = 'structured_pre_upstream_rejection' THEN artifact."updated_at" ELSE NULL END
FROM "authoring_artifacts" AS artifact
WHERE artifact."artifact_key" LIKE 'video-submission:%'
  AND artifact."payload" IS NOT NULL
  AND jsonb_typeof(artifact."payload"::jsonb) = 'object'
  AND artifact."payload"::jsonb ->> 'kind' <> 'explicit_replacement_authorized'
ON CONFLICT ("run_id", "effect_key", "revision") DO NOTHING;

WITH ranked_effects AS (
  SELECT
    effect."id",
    effect."run_id",
    effect."status",
    effect."updated_at",
    row_number() OVER (PARTITION BY effect."run_id" ORDER BY effect."created_at", effect."id") AS seq
  FROM "production_effects" AS effect
)
INSERT INTO "production_workflow_events" (
  "id", "run_id", "seq", "workflow_node_id", "event_kind",
  "payload_ref", "artifact_ids", "effect_ids", "created_at"
)
SELECT
  gen_random_uuid()::text,
  ranked."run_id",
  ranked.seq,
  'media-production',
  'effect',
  'production-effect:' || ranked."id" || ':' || ranked."status",
  '[]',
  jsonb_build_array(ranked."id")::text,
  ranked."updated_at"
FROM ranked_effects AS ranked
ON CONFLICT ("run_id", "seq") DO NOTHING;
