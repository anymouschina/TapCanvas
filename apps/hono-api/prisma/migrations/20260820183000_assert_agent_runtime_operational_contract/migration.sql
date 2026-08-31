-- Operational assertion for the agents-cli/Hono cutover.
-- This migration is intentionally read-only: it fails deployment when the
-- durable task-status identity or reconciliation indexes are missing, rather
-- than letting a worker start with a silently degraded recovery queue.
DO $$
BEGIN
    IF to_regclass('public.task_statuses') IS NULL THEN
        RAISE EXCEPTION 'agent runtime requires task_statuses table';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.task_statuses'::regclass
          AND contype = 'u'
          AND conname = 'task_statuses_task_id_provider_key'
    ) THEN
        RAISE EXCEPTION 'agent runtime requires task_statuses(task_id, provider) unique identity';
    END IF;

    IF to_regclass('public.idx_task_statuses_provider_status_updated') IS NULL THEN
        RAISE EXCEPTION 'agent runtime requires waiting-queue reconciliation index';
    END IF;
END $$;
