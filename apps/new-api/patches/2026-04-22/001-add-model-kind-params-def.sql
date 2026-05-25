-- 001-add-model-kind-params-def.sql
-- Purpose: add kind, capabilities, params_def columns to models table.
-- Scope: PostgreSQL only, schema-only, idempotent (IF NOT EXISTS).

BEGIN;

ALTER TABLE models ADD COLUMN IF NOT EXISTS kind         VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE models ADD COLUMN IF NOT EXISTS capabilities TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS params_def   TEXT;

COMMIT;
