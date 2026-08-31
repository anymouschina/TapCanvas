-- Durable agents runtime state: context windows, causal rollout events,
-- steering messages and follow-up messages share this session-scoped JSONB.
ALTER TABLE "agent_sessions"
ADD COLUMN "meta" JSONB;
