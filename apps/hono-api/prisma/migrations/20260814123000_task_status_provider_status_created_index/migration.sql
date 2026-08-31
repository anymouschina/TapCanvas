-- task_statuses is a hot, pre-existing async ledger. Keep this migration to
-- exactly one statement: PostgreSQL forbids CREATE INDEX CONCURRENTLY inside a
-- transaction block, and multi-statement migration scripts may be sent as one
-- implicit transaction by the database driver.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_task_statuses_provider_status_created"
  ON "task_statuses" ("provider", "status", "created_at");
