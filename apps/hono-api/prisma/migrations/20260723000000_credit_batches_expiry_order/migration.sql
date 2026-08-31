CREATE TABLE IF NOT EXISTS "team_credit_batches" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "original_amount" INTEGER NOT NULL,
    "remaining_amount" INTEGER NOT NULL,
    "reserved_amount" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TEXT,
    "granted_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "team_credit_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "team_credit_batches_amount_check" CHECK (
        "original_amount" > 0
        AND "remaining_amount" >= 0
        AND "reserved_amount" >= 0
        AND "reserved_amount" <= "remaining_amount"
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_credit_batches_team_id_source_type_source_key_key"
    ON "team_credit_batches"("team_id", "source_type", "source_key");
CREATE INDEX IF NOT EXISTS "idx_team_credit_batches_spend_order"
    ON "team_credit_batches"("team_id", "expires_at", "granted_at");

CREATE TABLE IF NOT EXISTS "team_credit_allocations" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "ledger_entry_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "expired_amount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "team_credit_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "team_credit_allocations_amount_check" CHECK (
        "amount" > 0
        AND "expired_amount" >= 0
        AND "expired_amount" <= "amount"
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_credit_allocations_ledger_entry_id_batch_id_key"
    ON "team_credit_allocations"("ledger_entry_id", "batch_id");
CREATE INDEX IF NOT EXISTS "idx_team_credit_allocations_ledger_priority"
    ON "team_credit_allocations"("team_id", "ledger_entry_id", "priority");
CREATE INDEX IF NOT EXISTS "idx_team_credit_allocations_batch"
    ON "team_credit_allocations"("batch_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_credit_batches_team_id_fkey'
    ) THEN
        ALTER TABLE "team_credit_batches"
            ADD CONSTRAINT "team_credit_batches_team_id_fkey"
            FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_credit_allocations_team_id_fkey'
    ) THEN
        ALTER TABLE "team_credit_allocations"
            ADD CONSTRAINT "team_credit_allocations_team_id_fkey"
            FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_credit_allocations_ledger_entry_id_fkey'
    ) THEN
        ALTER TABLE "team_credit_allocations"
            ADD CONSTRAINT "team_credit_allocations_ledger_entry_id_fkey"
            FOREIGN KEY ("ledger_entry_id") REFERENCES "team_credit_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_credit_allocations_batch_id_fkey'
    ) THEN
        ALTER TABLE "team_credit_allocations"
            ADD CONSTRAINT "team_credit_allocations_batch_id_fkey"
            FOREIGN KEY ("batch_id") REFERENCES "team_credit_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Historical ledger rows are not a reliable projection of the current frozen
-- balance: old settlement paths could cap, overrun, rebind, or orphan a
-- reservation. The aggregate team row is the only confirmed cutover fact.
-- Preserve that fact without pretending it belongs to a historical task.
-- Runtime schema bootstrap briefly shipped this migration's first draft, so
-- remove only rows carrying that draft's explicit provenance before rebuilding.
DELETE FROM "team_credit_allocations" allocation
USING "team_credit_batches" batch
WHERE allocation."batch_id" = batch."id"
  AND batch."source_type" = 'legacy_balance'
  AND (
      allocation."id" LIKE 'legacy_reserve:%'
      OR allocation."id" LIKE 'legacy_frozen_allocation:%'
  );

DELETE FROM "team_credit_ledger"
WHERE "id" LIKE 'legacy_frozen:%'
  AND "task_kind" = 'legacy_frozen_balance';

DO $$
DECLARE
    invalid_residual RECORD;
BEGIN
    SELECT residuals.*
    INTO invalid_residual
    FROM (
        SELECT
            t."id" AS team_id,
            t."credits" - COALESCE(SUM(b."remaining_amount"), 0) AS legacy_remaining,
            t."credits_frozen" - COALESCE(SUM(b."reserved_amount"), 0) AS legacy_reserved
        FROM "teams" t
        LEFT JOIN "team_credit_batches" b
          ON b."team_id" = t."id"
         AND b."source_type" <> 'legacy_balance'
        GROUP BY t."id", t."credits", t."credits_frozen"
    ) residuals
    WHERE residuals.legacy_remaining < 0
       OR residuals.legacy_reserved < 0
       OR residuals.legacy_reserved > residuals.legacy_remaining
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'credit batch cutover residual invalid for team %: remaining=%, reserved=%',
            invalid_residual.team_id,
            invalid_residual.legacy_remaining,
            invalid_residual.legacy_reserved;
    END IF;
END $$;

WITH residuals AS (
    SELECT
        t."id" AS team_id,
        t."credits" - COALESCE(SUM(b."remaining_amount"), 0) AS legacy_remaining,
        t."credits_frozen" - COALESCE(SUM(b."reserved_amount"), 0) AS legacy_reserved
    FROM "teams" t
    LEFT JOIN "team_credit_batches" b
      ON b."team_id" = t."id"
     AND b."source_type" <> 'legacy_balance'
    GROUP BY t."id", t."credits", t."credits_frozen"
)
UPDATE "team_credit_batches" legacy
SET "original_amount" = GREATEST(legacy."original_amount", residuals.legacy_remaining, 1),
    "remaining_amount" = residuals.legacy_remaining,
    "reserved_amount" = residuals.legacy_reserved,
    "expires_at" = NULL,
    "updated_at" = NOW()::TEXT
FROM residuals
WHERE legacy."team_id" = residuals.team_id
  AND legacy."source_type" = 'legacy_balance';

WITH residuals AS (
    SELECT
        t."id" AS team_id,
        t."created_at" AS team_created_at,
        t."credits" - COALESCE(SUM(b."remaining_amount"), 0) AS legacy_remaining,
        t."credits_frozen" - COALESCE(SUM(b."reserved_amount"), 0) AS legacy_reserved
    FROM "teams" t
    LEFT JOIN "team_credit_batches" b
      ON b."team_id" = t."id"
     AND b."source_type" <> 'legacy_balance'
    GROUP BY t."id", t."created_at", t."credits", t."credits_frozen"
)
INSERT INTO "team_credit_batches" (
    "id", "team_id", "source_type", "source_key", "original_amount",
    "remaining_amount", "reserved_amount", "expires_at", "granted_at",
    "created_at", "updated_at"
)
SELECT
    'legacy_balance:' || residuals.team_id,
    residuals.team_id,
    'legacy_balance',
    residuals.team_id,
    GREATEST(residuals.legacy_remaining, 1),
    residuals.legacy_remaining,
    residuals.legacy_reserved,
    NULL,
    residuals.team_created_at,
    NOW()::TEXT,
    NOW()::TEXT
FROM residuals
WHERE residuals.legacy_remaining > 0
  AND NOT EXISTS (
      SELECT 1
      FROM "team_credit_batches" existing
      WHERE existing."team_id" = residuals.team_id
        AND existing."source_type" = 'legacy_balance'
  );

INSERT INTO "team_credit_ledger" (
    "id", "team_id", "entry_type", "amount", "task_id", "task_kind",
    "actor_user_id", "note", "created_at", "api_key_id"
)
SELECT
    'legacy_frozen:' || legacy."team_id",
    legacy."team_id",
    'reserve',
    legacy."reserved_amount",
    'legacy_frozen:' || legacy."team_id",
    'legacy_frozen_balance',
    NULL,
    'Unattributed frozen balance preserved at credit-batch hard cutover',
    NOW()::TEXT,
    NULL
FROM "team_credit_batches" legacy
WHERE legacy."source_type" = 'legacy_balance'
  AND legacy."reserved_amount" > 0;

INSERT INTO "team_credit_allocations" (
    "id", "team_id", "ledger_entry_id", "batch_id", "priority",
    "amount", "expired_amount", "created_at"
)
SELECT
    'legacy_frozen_allocation:' || legacy."team_id",
    legacy."team_id",
    'legacy_frozen:' || legacy."team_id",
    legacy."id",
    0,
    legacy."reserved_amount",
    0,
    NOW()::TEXT
FROM "team_credit_batches" legacy
WHERE legacy."source_type" = 'legacy_balance'
  AND legacy."reserved_amount" > 0;

DO $$
DECLARE
    mismatch RECORD;
BEGIN
    SELECT
        t."id" AS team_id,
        t."credits",
        t."credits_frozen",
        COALESCE(SUM(b."remaining_amount"), 0) AS batch_remaining,
        COALESCE(SUM(b."reserved_amount"), 0) AS batch_reserved
    INTO mismatch
    FROM "teams" t
    LEFT JOIN "team_credit_batches" b ON b."team_id" = t."id"
    GROUP BY t."id", t."credits", t."credits_frozen"
    HAVING t."credits" <> COALESCE(SUM(b."remaining_amount"), 0)
        OR t."credits_frozen" <> COALESCE(SUM(b."reserved_amount"), 0)
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'credit batch backfill mismatch for team %: team=%/%, batches=%/%',
            mismatch.team_id,
            mismatch.credits,
            mismatch.credits_frozen,
            mismatch.batch_remaining,
            mismatch.batch_reserved;
    END IF;

    SELECT
        reservation_totals.team_id,
        reservation_totals.batch_reserved,
        reservation_totals.allocated_reserved
    INTO mismatch
    FROM (
        SELECT
            b."id" AS batch_id,
            b."team_id" AS team_id,
            b."reserved_amount" AS batch_reserved,
            COALESCE(SUM(
                CASE
                    WHEN reserve_ledger."id" IS NULL THEN 0
                    ELSE GREATEST(0, reserve_allocation."amount" - COALESCE((
                        SELECT SUM(settlement_allocation."amount")
                        FROM "team_credit_allocations" settlement_allocation
                        JOIN "team_credit_ledger" settlement_ledger
                          ON settlement_ledger."id" = settlement_allocation."ledger_entry_id"
                        WHERE settlement_allocation."batch_id" = b."id"
                          AND settlement_ledger."team_id" = reserve_ledger."team_id"
                          AND settlement_ledger."task_id" = reserve_ledger."task_id"
                          AND settlement_ledger."entry_type" IN ('deduct', 'release')
                    ), 0))
                END
            ), 0) AS allocated_reserved
        FROM "team_credit_batches" b
        LEFT JOIN "team_credit_allocations" reserve_allocation
          ON reserve_allocation."batch_id" = b."id"
        LEFT JOIN "team_credit_ledger" reserve_ledger
          ON reserve_ledger."id" = reserve_allocation."ledger_entry_id"
         AND reserve_ledger."entry_type" = 'reserve'
        GROUP BY b."id", b."team_id", b."reserved_amount"
    ) reservation_totals
    WHERE reservation_totals.batch_reserved <> reservation_totals.allocated_reserved
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'credit reservation backfill mismatch for team %: batch=%, allocations=%',
            mismatch.team_id,
            mismatch.batch_reserved,
            mismatch.allocated_reserved;
    END IF;
END $$;
