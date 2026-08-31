-- tapcanvas:manual-operation
-- tapcanvas:recover-failed-assertion=AgentSessionEvent@1 hard cutover is incomplete
--
-- AgentSessionEvent@1 is an operator-controlled data hard cutover, not a
-- deployment prerequisite. The conversion remains available exclusively via
-- the agents-cli session-events:migrate command after a verified PostgreSQL
-- backup. Prisma records this no-op migration without reading or rewriting
-- durable agent history, so an intentionally deferred operation cannot block
-- unrelated schema deployments.
DO $$
BEGIN
    RAISE NOTICE 'AgentSessionEvent@1 data conversion is managed separately by session-events:migrate';
END $$;
