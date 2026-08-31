-- Version-pinned workflow plugin catalog and independent admission ledger.
-- This migration is additive: it does not rewrite an existing workflow node.
-- Plugin manifests remain inert until an independent admission row exists and
-- trusted host code provides the exact pinned owner adapter.

CREATE TABLE IF NOT EXISTS "workflow_plugin_versions" (
  "id" TEXT PRIMARY KEY,
  "plugin_id" TEXT NOT NULL,
  "plugin_version" TEXT NOT NULL,
  "publisher_kind" TEXT NOT NULL,
  "publisher_id" TEXT NOT NULL,
  "manifest_json" TEXT NOT NULL,
  "manifest_sha256" TEXT NOT NULL,
  "runtime_owner_kind" TEXT NOT NULL,
  "runtime_owner_id" TEXT NOT NULL,
  "runtime_version" TEXT NOT NULL,
  "created_by_actor" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "chk_workflow_plugin_versions_publisher_kind"
    CHECK ("publisher_kind" IN ('platform', 'user', 'team')),
  CONSTRAINT "chk_workflow_plugin_versions_manifest_sha256"
    CHECK ("manifest_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chk_workflow_plugin_versions_runtime_owner_kind"
    CHECK ("runtime_owner_kind" IN ('host', 'agents-cli', 'hono-api', 'isolated-worker'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_workflow_plugin_versions_identity"
  ON "workflow_plugin_versions" ("plugin_id", "plugin_version");
CREATE INDEX IF NOT EXISTS "idx_workflow_plugin_versions_manifest_sha256"
  ON "workflow_plugin_versions" ("manifest_sha256");
CREATE INDEX IF NOT EXISTS "idx_workflow_plugin_versions_publisher"
  ON "workflow_plugin_versions" ("publisher_kind", "publisher_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_workflow_plugin_versions_runtime_owner"
  ON "workflow_plugin_versions" ("runtime_owner_kind", "runtime_owner_id", "runtime_version");

CREATE TABLE IF NOT EXISTS "workflow_plugin_admissions" (
  "id" TEXT PRIMARY KEY,
  "plugin_version_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "granted_permissions_json" TEXT NOT NULL,
  "decision_revision" INTEGER NOT NULL DEFAULT 1,
  "decided_by_actor" TEXT NOT NULL,
  "reason" TEXT,
  "admitted_at" TEXT NOT NULL,
  "revoked_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "workflow_plugin_admissions_plugin_version_id_fkey"
    FOREIGN KEY ("plugin_version_id") REFERENCES "workflow_plugin_versions" ("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "chk_workflow_plugin_admissions_status"
    CHECK ("status" IN ('admitted', 'revoked')),
  CONSTRAINT "chk_workflow_plugin_admissions_revision"
    CHECK ("decision_revision" > 0),
  CONSTRAINT "chk_workflow_plugin_admissions_revocation"
    CHECK (
      ("status" = 'admitted' AND "revoked_at" IS NULL)
      OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_workflow_plugin_admissions_version"
  ON "workflow_plugin_admissions" ("plugin_version_id");
CREATE INDEX IF NOT EXISTS "idx_workflow_plugin_admissions_status_updated"
  ON "workflow_plugin_admissions" ("status", "updated_at" DESC);
