-- Repair task identity indexes that can be marked valid while omitting heap
-- tuples.  In that state an indexed lookup can expose an old running/claimed
-- row even though a newer terminal row exists for the same logical identity.
--
-- The deployment procedure takes a physical backup before applying this
-- migration.  The migration itself preserves exactly one canonical row per
-- identity: delivered terminal evidence wins over failure, and failure wins
-- over non-terminal state.  Within the same state class the newest completed
-- evidence wins, followed by the most recently updated row.

BEGIN;

SET LOCAL enable_indexscan = off;
SET LOCAL enable_bitmapscan = off;

WITH ranked AS (
  SELECT
    ctid AS row_ctid,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, task_id
      ORDER BY
        CASE status
          WHEN 'succeeded' THEN 0
          WHEN 'completed' THEN 0
          WHEN 'failed' THEN 1
          WHEN 'cancelled' THEN 2
          WHEN 'claimed' THEN 3
          WHEN 'running' THEN 4
          WHEN 'queued' THEN 5
          ELSE 6
        END,
        CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END,
        completed_at DESC NULLS LAST,
        updated_at DESC,
        length(result) DESC,
        created_at DESC,
        ctid DESC
    ) AS identity_rank
  FROM task_results
), losers AS (
  SELECT row_ctid
  FROM ranked
  WHERE identity_rank > 1
)
DELETE FROM task_results AS task
USING losers
WHERE task.ctid = losers.row_ctid;

WITH ranked AS (
  SELECT
    ctid AS row_ctid,
    ROW_NUMBER() OVER (
      PARTITION BY task_id, provider
      ORDER BY
        CASE status
          WHEN 'succeeded' THEN 0
          WHEN 'completed' THEN 0
          WHEN 'failed' THEN 1
          WHEN 'cancelled' THEN 2
          WHEN 'claimed' THEN 3
          WHEN 'running' THEN 4
          WHEN 'waiting' THEN 5
          WHEN 'queued' THEN 6
          ELSE 7
        END,
        CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END,
        completed_at DESC NULLS LAST,
        updated_at DESC,
        length(COALESCE(data, '')) DESC,
        created_at DESC,
        ctid DESC
    ) AS identity_rank
  FROM task_statuses
), losers AS (
  SELECT row_ctid
  FROM ranked
  WHERE identity_rank > 1
)
DELETE FROM task_statuses AS task_status
USING losers
WHERE task_status.ctid = losers.row_ctid;

-- Rebuild every lookup path, not only the unique indexes that first exposed
-- the corruption.  No task payload or terminal state is rewritten here.
REINDEX TABLE task_results;
REINDEX TABLE task_statuses;

ANALYZE task_results;
ANALYZE task_statuses;

DO $$
DECLARE
  duplicate_task_result RECORD;
  duplicate_task_status RECORD;
BEGIN
  SET LOCAL enable_indexscan = off;
  SET LOCAL enable_bitmapscan = off;

  SELECT user_id, task_id, COUNT(*) AS duplicate_count
  INTO duplicate_task_result
  FROM task_results
  GROUP BY user_id, task_id
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'task_results identity repair incomplete for user %, task %: % rows remain',
      duplicate_task_result.user_id,
      duplicate_task_result.task_id,
      duplicate_task_result.duplicate_count;
  END IF;

  SELECT task_id, provider, COUNT(*) AS duplicate_count
  INTO duplicate_task_status
  FROM task_statuses
  GROUP BY task_id, provider
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'task_statuses identity repair incomplete for task %, provider %: % rows remain',
      duplicate_task_status.task_id,
      duplicate_task_status.provider,
      duplicate_task_status.duplicate_count;
  END IF;
END $$;

COMMIT;
