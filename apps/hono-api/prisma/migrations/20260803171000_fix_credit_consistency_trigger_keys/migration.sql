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
                   WHEN reserve_ledger."id" IS NULL THEN 0
                   ELSE GREATEST(0, reserve_allocation."amount" - COALESCE((
                       SELECT SUM(settlement_allocation."amount")
                       FROM "team_credit_allocations" settlement_allocation
                       JOIN "team_credit_ledger" settlement_ledger
                         ON settlement_ledger."id" = settlement_allocation."ledger_entry_id"
                       WHERE settlement_allocation."batch_id" = batch."id"
                         AND settlement_ledger."team_id" = reserve_ledger."team_id"
                         AND settlement_ledger."task_id" = reserve_ledger."task_id"
                         AND settlement_ledger."entry_type" IN ('deduct', 'release')
                   ), 0))
               END
           ), 0) AS allocated_reserved
    INTO reservation_mismatch
    FROM "team_credit_batches" batch
    LEFT JOIN "team_credit_allocations" reserve_allocation
      ON reserve_allocation."batch_id" = batch."id"
    LEFT JOIN "team_credit_ledger" reserve_ledger
      ON reserve_ledger."id" = reserve_allocation."ledger_entry_id"
     AND reserve_ledger."entry_type" = 'reserve'
    WHERE batch."team_id" = target_team_id
    GROUP BY batch."id", batch."reserved_amount"
    HAVING batch."reserved_amount" <> COALESCE(SUM(
        CASE
            WHEN reserve_ledger."id" IS NULL THEN 0
            ELSE GREATEST(0, reserve_allocation."amount" - COALESCE((
                SELECT SUM(settlement_allocation."amount")
                FROM "team_credit_allocations" settlement_allocation
                JOIN "team_credit_ledger" settlement_ledger
                  ON settlement_ledger."id" = settlement_allocation."ledger_entry_id"
                WHERE settlement_allocation."batch_id" = batch."id"
                  AND settlement_ledger."team_id" = reserve_ledger."team_id"
                  AND settlement_ledger."task_id" = reserve_ledger."task_id"
                  AND settlement_ledger."entry_type" IN ('deduct', 'release')
            ), 0))
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

CREATE OR REPLACE FUNCTION tapcanvas_assert_credit_ledger_allocation_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    new_row JSONB := COALESCE(to_jsonb(NEW), '{}'::JSONB);
    old_row JSONB := COALESCE(to_jsonb(OLD), '{}'::JSONB);
    target_ledger_id TEXT;
    ledger_row RECORD;
    allocated BIGINT;
BEGIN
    target_ledger_id := CASE
        WHEN TG_TABLE_NAME = 'team_credit_ledger'
        THEN COALESCE(new_row ->> 'id', old_row ->> 'id')
        ELSE COALESCE(new_row ->> 'ledger_entry_id', old_row ->> 'ledger_entry_id')
    END;

    IF target_ledger_id IS NULL THEN
        RAISE EXCEPTION 'credit consistency trigger could not resolve ledger id for table %', TG_TABLE_NAME;
    END IF;

    SELECT "id", "team_id", "entry_type", "amount"
    INTO ledger_row
    FROM "team_credit_ledger"
    WHERE "id" = target_ledger_id;

    IF NOT FOUND OR ledger_row.entry_type NOT IN ('reserve', 'deduct', 'release') THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM("amount"), 0)
    INTO allocated
    FROM "team_credit_allocations"
    WHERE "ledger_entry_id" = target_ledger_id;

    IF ledger_row.amount <> allocated THEN
        RAISE EXCEPTION
            'credit ledger allocation commit mismatch for ledger %, team %, type %: ledger=%, allocations=%',
            ledger_row.id, ledger_row.team_id, ledger_row.entry_type,
            ledger_row.amount, allocated;
    END IF;

    RETURN NULL;
END $$;

