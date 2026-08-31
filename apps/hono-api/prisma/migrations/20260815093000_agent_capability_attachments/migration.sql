CREATE TABLE IF NOT EXISTS "agent_capability_attachments" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "capability_kind" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "source_version_id" TEXT NOT NULL,
  "descriptor_json" TEXT NOT NULL,
  "descriptor_sha256" TEXT NOT NULL,
  "conflict_report_json" TEXT NOT NULL,
  "conflict_report_revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,

  CONSTRAINT "agent_capability_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_capability_attachments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_capability_attachments_user_source"
  ON "agent_capability_attachments"("user_id", "capability_kind", "source_id");

CREATE INDEX IF NOT EXISTS "idx_agent_capability_attachments_user_updated"
  ON "agent_capability_attachments"("user_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_agent_capability_attachments_source_version"
  ON "agent_capability_attachments"("source_version_id");
