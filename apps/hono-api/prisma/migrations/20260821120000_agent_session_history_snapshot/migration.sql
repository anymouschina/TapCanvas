-- The append-only message journal remains available for legacy audit, but it
-- must never be replayed wholesale on the request path. This projection is
-- the single bounded checkpoint used by the live Agents bridge.
ALTER TABLE "agent_sessions"
ADD COLUMN IF NOT EXISTS "history_snapshot" JSONB;
