ALTER TABLE "api_keys"
  ADD COLUMN IF NOT EXISTS "scopes" TEXT NOT NULL DEFAULT '["public:read","public:write","agent:execute"]',
  ADD COLUMN IF NOT EXISTS "expires_at" TEXT,
  ADD COLUMN IF NOT EXISTS "revoked_at" TEXT,
  ADD COLUMN IF NOT EXISTS "rotated_from_id" TEXT;

-- Existing keys retain their complete CLI / Agent API surface after the cutover.
-- New rows that bypass the application service remain least-privileged and match
-- the Prisma schema default; normal CLI/Codex creation explicitly requests all scopes.
ALTER TABLE "api_keys"
  ALTER COLUMN "scopes" SET DEFAULT '["public:read"]';

CREATE INDEX IF NOT EXISTS "idx_api_keys_owner_expires"
  ON "api_keys" ("owner_id", "expires_at");

CREATE INDEX IF NOT EXISTS "idx_api_keys_rotated_from"
  ON "api_keys" ("rotated_from_id");
