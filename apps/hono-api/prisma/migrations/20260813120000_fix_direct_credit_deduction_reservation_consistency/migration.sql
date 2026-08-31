-- A balance charge and a reservation settlement both use a `deduct` ledger
-- entry, but only the latter consumes frozen credits.  The previous net
-- reservation check subtracted every deduct allocation, so an administrator
-- balance adjustment made a valid batch look under-reserved at commit time.
-- A deduct/release allocation now reduces the reservation projection only
-- when the same team/task has a reserve allocation in the same batch.

CREATE OR REPLACE FUNCTION tapcanvas_assert_credit_batch_team_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    new_row JSONB := COALESCE(to_jsonb(NEW), '{}'::JSONB);
    old_row JSONB := COALESCE(to_jsonb(OLD), '{}'::JSONB);
    target_team_id TEXT;
    team_balance RECORD;
    reservation_mismatch RECORD;
BEGIN
    target_team_id := CASE
        WHEN TG_TABLE_NAME = 'teams'
        THEN COALESCE(new_row ->> 'id', old_row ->> 'id')
        ELSE COALESCE(new_row ->> 'team_id', old_row ->> 'team_id')
    END;

    IF target_team_id IS NULL THEN
        RAISE EXCEPTION 'credit consistency trigger could not resolve team id for table %', TG_TABLE_NAME;
    END IF;

    SELECT team."credits", team."credits_frozen",
           COALESCE(SUM(batch."remaining_amount"), 0) AS batch_remaining,
           COALESCE(SUM(batch."reserved_amount"), 0) AS batch_reserved
    INTO team_balance
    FROM "teams" team
    LEFT JOIN "team_credit_batches" batch ON batch."team_id" = team."id"
    WHERE team."id" = target_team_id
    GROUP BY team."id", team."credits", team."credits_frozen";

    IF FOUND AND (
        team_balance.credits <> team_balance.batch_remaining
        OR team_balance.credits_frozen <> team_balance.batch_reserved
    ) THEN
        RAISE EXCEPTION
            'credit batch commit mismatch for team %: team=%/%, batches=%/%',
            target_team_id, team_balance.credits, team_balance.credits_frozen,
            team_balance.batch_remaining, team_balance.batch_reserved;
    END IF;

    SELECT batch."id", batch."reserved_amount",
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
    INTO reservation_mismatch
    FROM "team_credit_batches" batch
    LEFT JOIN "team_credit_allocations" allocation
      ON allocation."batch_id" = batch."id"
    LEFT JOIN "team_credit_ledger" ledger
      ON ledger."id" = allocation."ledger_entry_id"
    WHERE batch."team_id" = target_team_id
    GROUP BY batch."id", batch."reserved_amount"
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
            'credit reservation commit mismatch for team %, batch %: batch=%, allocations=%',
            target_team_id, reservation_mismatch.id,
            reservation_mismatch.reserved_amount,
            reservation_mismatch.allocated_reserved;
    END IF;

    RETURN NULL;
END $$;
