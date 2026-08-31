-- Canonical workflow execution families and per-attempt history.
-- This migration is additive: existing executions are grouped by their immutable
-- recovery ancestry, and existing node-run rows remain the latest-state projection.

BEGIN;

-- The hard cutover must observe one stable, fully drained execution set. The
-- exclusive lock prevents a new execution from being admitted after the check
-- but before the new NOT NULL family identity and attempt ledger are installed.
LOCK TABLE "workflow_executions" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "workflow_executions"
    WHERE "status" IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION 'active workflow executions must be drained before enabling the node attempt ledger hard cutover';
  END IF;
END $$;

ALTER TABLE "workflow_executions"
  ADD COLUMN "execution_family_id" TEXT;

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
    RAISE EXCEPTION 'workflow execution recovery ancestry is orphaned or cyclic; execution families cannot be proven';
  END IF;
END $$;

ALTER TABLE "workflow_executions"
  ALTER COLUMN "execution_family_id" SET NOT NULL;

CREATE INDEX "idx_workflow_executions_family_created"
  ON "workflow_executions" ("execution_family_id", "created_at" ASC, "id" ASC);

CREATE TABLE "workflow_node_attempts" (
  "id" TEXT PRIMARY KEY,
  "execution_family_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "node_run_id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL,
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
  CONSTRAINT "workflow_node_attempts_execution_id_fkey"
    FOREIGN KEY ("execution_id") REFERENCES "workflow_executions" ("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "workflow_node_attempts_node_run_id_fkey"
    FOREIGN KEY ("node_run_id") REFERENCES "workflow_node_runs" ("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "chk_workflow_node_attempts_attempt_positive"
    CHECK ("attempt" > 0),
  CONSTRAINT "chk_workflow_node_attempts_trigger"
    CHECK ("trigger" IN ('initial', 'recovery_execution', 'runtime_recovery', 'automatic_retry', 'manual_repair')),
  CONSTRAINT "chk_workflow_node_attempts_status"
    CHECK ("status" IN ('pending', 'queued', 'running', 'waiting_external', 'success', 'failed', 'canceled', 'skipped', 'not_selected'))
);

CREATE UNIQUE INDEX "uq_workflow_node_attempts_run_attempt"
  ON "workflow_node_attempts" ("node_run_id", "attempt");
CREATE INDEX "idx_workflow_node_attempts_family_created"
  ON "workflow_node_attempts" ("execution_family_id", "created_at" ASC, "id" ASC);
CREATE INDEX "idx_workflow_node_attempts_execution_node"
  ON "workflow_node_attempts" ("execution_id", "node_id", "attempt" ASC);
CREATE INDEX "idx_workflow_node_attempts_provider_receipts"
  ON "workflow_node_attempts" ("execution_family_id")
  WHERE "provider_receipts" IS NOT NULL;

COMMIT;
