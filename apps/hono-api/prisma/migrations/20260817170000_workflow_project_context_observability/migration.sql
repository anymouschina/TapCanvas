ALTER TABLE "workflow_executions"
  ADD COLUMN "error_code" TEXT,
  ADD COLUMN "failure_stage" TEXT,
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "canvas_id" TEXT,
  ADD COLUMN "user_input" TEXT,
  ADD COLUMN "project_context" TEXT,
  ADD COLUMN "asset_snapshot" TEXT,
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recovery_of_execution_id" TEXT,
  ADD COLUMN "uses_project_assets" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "workflow_node_runs"
  ADD COLUMN "error_code" TEXT,
  ADD COLUMN "failure_stage" TEXT,
  ADD COLUMN "input_refs" TEXT,
  ADD COLUMN "tool_calls" TEXT,
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "node_type" TEXT,
  ADD COLUMN "tool_name" TEXT,
  ADD COLUMN "model_key" TEXT;

CREATE INDEX "idx_workflow_executions_project_id" ON "workflow_executions"("project_id");
CREATE INDEX "idx_workflow_executions_recovery_of" ON "workflow_executions"("recovery_of_execution_id");
