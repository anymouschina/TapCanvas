-- Repair settlement rows written by a pre-cutover process after credit batches
-- became authoritative. A repair is provable only when the settlement has a
-- matching reserve ledger with still-open batch allocations.
WITH settlement_gaps AS (
    SELECT
        settlement."id" AS settlement_id,
        settlement."team_id" AS team_id,
        settlement."task_id" AS task_id,
        settlement."entry_type" AS entry_type,
        settlement."created_at" AS settled_at,
        settlement."amount" - COALESCE(SUM(existing."amount"), 0) AS missing_amount
    FROM "team_credit_ledger" settlement
    LEFT JOIN "team_credit_allocations" existing
      ON existing."ledger_entry_id" = settlement."id"
    WHERE settlement."entry_type" IN ('deduct', 'release')
      AND settlement."task_id" IS NOT NULL
    GROUP BY settlement."id", settlement."team_id", settlement."task_id",
             settlement."entry_type", settlement."created_at", settlement."amount"
    HAVING settlement."amount" > COALESCE(SUM(existing."amount"), 0)
), reserve_slots AS (
    SELECT
        gap.*,
        reserve_allocation."batch_id" AS batch_id,
        reserve_allocation."priority" AS priority,
        GREATEST(
            0,
            reserve_allocation."amount" - COALESCE((
                SELECT SUM(applied."amount")
                FROM "team_credit_allocations" applied
                JOIN "team_credit_ledger" applied_ledger
                  ON applied_ledger."id" = applied."ledger_entry_id"
                WHERE applied."batch_id" = reserve_allocation."batch_id"
                  AND applied_ledger."team_id" = gap.team_id
                  AND applied_ledger."task_id" = gap.task_id
                  AND applied_ledger."entry_type" IN ('deduct', 'release')
            ), 0)
        ) AS available_amount
    FROM settlement_gaps gap
    JOIN "team_credit_ledger" reserve_ledger
      ON reserve_ledger."team_id" = gap.team_id
     AND reserve_ledger."task_id" = gap.task_id
     AND reserve_ledger."entry_type" = 'reserve'
    JOIN "team_credit_allocations" reserve_allocation
      ON reserve_allocation."ledger_entry_id" = reserve_ledger."id"
), planned_repairs AS (
    SELECT
        slots.*,
        COALESCE(SUM(slots.available_amount) OVER (
            PARTITION BY slots.settlement_id
            ORDER BY slots.priority, slots.batch_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) AS amount_before
    FROM reserve_slots slots
    WHERE slots.available_amount > 0
), inserted_repairs AS (
    INSERT INTO "team_credit_allocations" (
        "id", "team_id", "ledger_entry_id", "batch_id", "priority",
        "amount", "expired_amount", "created_at"
    )
    SELECT
        'settlement_repair:' || repair.settlement_id || ':' || repair.batch_id,
        repair.team_id,
        repair.settlement_id,
        repair.batch_id,
        repair.priority,
        LEAST(repair.available_amount, repair.missing_amount - repair.amount_before),
        CASE
            WHEN repair.entry_type = 'release'
             AND batch."expires_at" IS NOT NULL
             AND batch."expires_at" <= repair.settled_at
            THEN LEAST(repair.available_amount, repair.missing_amount - repair.amount_before)
            ELSE 0
        END,
        repair.settled_at
    FROM planned_repairs repair
    JOIN "team_credit_batches" batch ON batch."id" = repair.batch_id
    WHERE repair.amount_before < repair.missing_amount
    ON CONFLICT ("ledger_entry_id", "batch_id") DO NOTHING
    RETURNING "ledger_entry_id", "batch_id", "amount", "expired_amount"
), batch_repairs AS (
    SELECT
        inserted."batch_id",
        SUM(inserted."amount") AS settled_amount,
        SUM(CASE
            WHEN ledger."entry_type" = 'deduct' THEN inserted."amount"
            ELSE inserted."expired_amount"
        END) AS spent_amount
    FROM inserted_repairs inserted
    JOIN "team_credit_ledger" ledger ON ledger."id" = inserted."ledger_entry_id"
    GROUP BY inserted."batch_id"
)
UPDATE "team_credit_batches" batch
SET "reserved_amount" = batch."reserved_amount" - repair.settled_amount,
    "remaining_amount" = batch."remaining_amount" - repair.spent_amount,
    "updated_at" = NOW()::TEXT
FROM batch_repairs repair
WHERE batch."id" = repair.batch_id;

DO $$
DECLARE
    incomplete RECORD;
BEGIN
    SELECT ledger."id", ledger."team_id", ledger."entry_type", ledger."amount",
           COALESCE((
               SELECT SUM(allocation."amount")
               FROM "team_credit_allocations" allocation
               WHERE allocation."ledger_entry_id" = ledger."id"
           ), 0) AS allocated
    INTO incomplete
    FROM "team_credit_ledger" ledger
    WHERE ledger."entry_type" IN ('deduct', 'release')
      AND EXISTS (
          SELECT 1
          FROM "team_credit_ledger" reserve_ledger
          JOIN "team_credit_allocations" reserve_allocation
            ON reserve_allocation."ledger_entry_id" = reserve_ledger."id"
          WHERE reserve_ledger."team_id" = ledger."team_id"
            AND reserve_ledger."task_id" = ledger."task_id"
            AND reserve_ledger."entry_type" = 'reserve'
      )
      AND ledger."amount" <> COALESCE((
          SELECT SUM(allocation."amount")
          FROM "team_credit_allocations" allocation
          WHERE allocation."ledger_entry_id" = ledger."id"
      ), 0)
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'credit settlement allocation repair incomplete: ledger=%, team=%, type=%, ledger_amount=%, allocated=%',
            incomplete.id, incomplete.team_id, incomplete.entry_type,
            incomplete.amount, incomplete.allocated;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION tapcanvas_assert_credit_batch_team_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_team_id TEXT;
    team_balance RECORD;
    reservation_mismatch RECORD;
BEGIN
    target_team_id := CASE
        WHEN TG_TABLE_NAME = 'teams' THEN COALESCE(NEW."id", OLD."id")
        ELSE COALESCE(NEW."team_id", OLD."team_id")
    END;

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
    target_ledger_id TEXT;
    ledger_row RECORD;
    allocated BIGINT;
BEGIN
    target_ledger_id := CASE
        WHEN TG_TABLE_NAME = 'team_credit_ledger' THEN COALESCE(NEW."id", OLD."id")
        ELSE COALESCE(NEW."ledger_entry_id", OLD."ledger_entry_id")
    END;

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

CREATE CONSTRAINT TRIGGER "credit_batch_consistency_on_teams"
AFTER INSERT OR UPDATE OR DELETE ON "teams"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tapcanvas_assert_credit_batch_team_consistency();

CREATE CONSTRAINT TRIGGER "credit_batch_consistency_on_batches"
AFTER INSERT OR UPDATE OR DELETE ON "team_credit_batches"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tapcanvas_assert_credit_batch_team_consistency();

CREATE CONSTRAINT TRIGGER "credit_batch_consistency_on_allocations"
AFTER INSERT OR UPDATE OR DELETE ON "team_credit_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tapcanvas_assert_credit_batch_team_consistency();

CREATE CONSTRAINT TRIGGER "credit_ledger_allocation_on_ledger"
AFTER INSERT OR UPDATE ON "team_credit_ledger"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tapcanvas_assert_credit_ledger_allocation_consistency();

CREATE CONSTRAINT TRIGGER "credit_ledger_allocation_on_allocations"
AFTER INSERT OR UPDATE OR DELETE ON "team_credit_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tapcanvas_assert_credit_ledger_allocation_consistency();
