-- Keep this second online index in its own single-statement migration for the
-- same PostgreSQL transaction boundary required by CREATE INDEX CONCURRENTLY.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_task_statuses_provider_status_updated"
  ON "task_statuses" ("provider", "status", "updated_at");
