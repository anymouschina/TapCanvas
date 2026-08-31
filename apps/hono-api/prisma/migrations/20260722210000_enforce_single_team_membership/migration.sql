DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "team_plan_subscriptions"
    WHERE "status" = 'active'
    GROUP BY "team_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active team membership: duplicate active subscriptions exist';
  END IF;
END $$;

UPDATE "team_subscription_plans"
SET "enabled" = 0,
    "updated_at" = NOW()::text
WHERE "id" IN (
  'neo_team_plus_t2',
  'neo_team_plus_t3',
  'neo_team_pro_t2',
  'neo_team_pro_t3',
  'neo_team_max_t2'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "team_subscription_plans"
    WHERE "enabled" = 1 AND "price_annual_cents" > 0
    GROUP BY UPPER(TRIM("tier"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce fixed team plans: duplicate enabled tiers exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "uq_team_subscription_plans_enabled_tier"
  ON "team_subscription_plans" (UPPER(TRIM("tier")))
  WHERE "enabled" = 1 AND "price_annual_cents" > 0;

CREATE UNIQUE INDEX "uq_team_plan_subscriptions_active_team"
  ON "team_plan_subscriptions" ("team_id")
  WHERE "status" = 'active';

CREATE TABLE "team_subscription_fulfillments" (
  "order_id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "status" TEXT NOT NULL,
  "result_json" TEXT,
  "error_message" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "applied_at" TEXT,
  CONSTRAINT "team_subscription_fulfillments_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "team_subscription_fulfillments_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "team_subscription_fulfillments_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "team_subscription_fulfillments_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "team_subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "team_subscription_fulfillments_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "team_plan_subscriptions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "idx_team_subscription_fulfillments_team_created"
  ON "team_subscription_fulfillments" ("team_id", "created_at" DESC);

CREATE INDEX "idx_team_subscription_fulfillments_status_updated"
  ON "team_subscription_fulfillments" ("status", "updated_at");
