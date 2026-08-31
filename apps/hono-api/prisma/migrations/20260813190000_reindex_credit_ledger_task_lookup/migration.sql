-- Reservation settlement is keyed by (team_id, entry_type, task_id).  The
-- backing unique index can be marked valid while missing keys: in that state
-- a heap scan finds the reserve row, but the indexed lookup used by settlement
-- and the commit-time invariant does not.  Rebuild the lookup index without
-- rewriting balances, batches, ledger rows, or allocations.
REINDEX INDEX "team_credit_ledger_team_id_entry_type_task_id_key";

ANALYZE "team_credit_ledger";

-- Do not hide a real accounting mismatch behind the index repair.  The
-- migration succeeds only when the rebuilt lookup resolves every reservation
-- settlement back to its reserve allocation and the authoritative batch
-- counter agrees with that net allocation total.
DO $$
DECLARE
    mismatch RECORD;
BEGIN
    SELECT batch."team_id", batch."id", batch."reserved_amount",
           COALESCE(SUM(
               CASE
                   WHEN ledger."entry_type" = 'reserve' THEN allocation."amount"
                   WHEN ledger."entry_type" IN ('deduct', 'release')
                    AND EXISTS (
                        SELECT 1
                        FROM "team_credit_ledger" reserve_ledger
                        JOIN "team_credit_allocations" reserve_allocation
                          ON reserve_allocation."ledger_entry_id" = reserve_ledger."id"
                         AND reserve_allocation."batch_id" = allocation."batch_id"
                        WHERE reserve_ledger."team_id" = ledger."team_id"
                          AND reserve_ledger."entry_type" = 'reserve'
                          AND reserve_ledger."task_id" = ledger."task_id"
                    ) THEN -allocation."amount"
                   ELSE 0
               END
           ), 0) AS allocated_reserved
    INTO mismatch
    FROM "team_credit_batches" batch
    LEFT JOIN "team_credit_allocations" allocation
      ON allocation."batch_id" = batch."id"
    LEFT JOIN "team_credit_ledger" ledger
      ON ledger."id" = allocation."ledger_entry_id"
    GROUP BY batch."team_id", batch."id", batch."reserved_amount"
    HAVING batch."reserved_amount" <> COALESCE(SUM(
        CASE
            WHEN ledger."entry_type" = 'reserve' THEN allocation."amount"
            WHEN ledger."entry_type" IN ('deduct', 'release')
             AND EXISTS (
                 SELECT 1
                 FROM "team_credit_ledger" reserve_ledger
                 JOIN "team_credit_allocations" reserve_allocation
                   ON reserve_allocation."ledger_entry_id" = reserve_ledger."id"
                  AND reserve_allocation."batch_id" = allocation."batch_id"
                 WHERE reserve_ledger."team_id" = ledger."team_id"
                   AND reserve_ledger."entry_type" = 'reserve'
                   AND reserve_ledger."task_id" = ledger."task_id"
             ) THEN -allocation."amount"
            ELSE 0
        END
    ), 0)
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'credit reservation mismatch remains after ledger task lookup reindex for team %, batch %: batch=%, allocations=%',
            mismatch.team_id, mismatch.id,
            mismatch.reserved_amount, mismatch.allocated_reserved;
    END IF;
END $$;
