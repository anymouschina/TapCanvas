BEGIN;

UPDATE "team_plan_subscriptions"
SET
  "status" = 'expired',
  "updated_at" = NOW()::text
WHERE "billing_cycle" = 'monthly'
  AND "status" = 'active'
  AND "current_period_end"::timestamptz <= NOW();

COMMIT;
