-- Durable, cross-process ownership for one-click authoring/production drives.
-- This replaces the former Redis + process Map lock and therefore intentionally
-- has no fallback path when PostgreSQL is unavailable.
CREATE TABLE IF NOT EXISTS "production_run_leases" (
  "lease_key" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "acquired_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "production_run_leases_pkey" PRIMARY KEY ("lease_key"),
  CONSTRAINT "chk_production_run_lease_window" CHECK ("expires_at" > "acquired_at")
);

CREATE INDEX IF NOT EXISTS "idx_production_run_leases_expires_at"
  ON "production_run_leases" ("expires_at");
