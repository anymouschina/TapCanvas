-- CreateTable team_subscription_plans
CREATE TABLE "team_subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "price_monthly_cents" INTEGER NOT NULL DEFAULT 0,
    "price_annual_cents" INTEGER NOT NULL DEFAULT 0,
    "credits_per_seat_per_month" INTEGER NOT NULL DEFAULT 0,
    "max_seats" INTEGER NOT NULL DEFAULT 20,
    "min_seats" INTEGER NOT NULL DEFAULT 1,
    "features_json" TEXT,
    "sort_weight" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "team_subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_team_subscription_plans_enabled_sort" ON "team_subscription_plans"("enabled", "sort_weight");

-- CreateTable team_plan_subscriptions
CREATE TABLE "team_plan_subscriptions" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "seat_count" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_period_start" TEXT NOT NULL,
    "current_period_end" TEXT NOT NULL,
    "next_credit_renewal_at" TEXT NOT NULL,
    "last_renewed_at" TEXT,
    "credits_per_renewal" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "team_plan_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_team_plan_subscriptions_team_status" ON "team_plan_subscriptions"("team_id", "status");

-- CreateIndex
CREATE INDEX "idx_team_plan_subscriptions_renewal" ON "team_plan_subscriptions"("status", "next_credit_renewal_at");

-- AddForeignKey
ALTER TABLE "team_plan_subscriptions" ADD CONSTRAINT "team_plan_subscriptions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "team_plan_subscriptions" ADD CONSTRAINT "team_plan_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "team_subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Seed: default subscription plans
INSERT INTO "team_subscription_plans" ("id", "name", "tier", "price_monthly_cents", "price_annual_cents", "credits_per_seat_per_month", "max_seats", "min_seats", "features_json", "sort_weight", "enabled", "created_at", "updated_at") VALUES
  ('plan_free',     '免费版', 'free',     0,       0,        0,     5,  1, '{"concurrent_tasks_per_seat":0,"canvas_collab":false,"shared_asset_library":false,"seat_management":false,"credit_quota_control":false}', 0, 1, NOW()::text, NOW()::text),
  ('plan_standard', '标准版', 'standard', 6100,    72900,   1500,  20,  2, '{"concurrent_tasks_per_seat":2,"canvas_collab":true,"shared_asset_library":true,"seat_management":true,"credit_quota_control":false}',  10, 1, NOW()::text, NOW()::text),
  ('plan_advanced', '进阶版', 'advanced', 11200,  134900,   4600,  50,  2, '{"concurrent_tasks_per_seat":4,"canvas_collab":true,"shared_asset_library":true,"seat_management":true,"credit_quota_control":true}',   20, 1, NOW()::text, NOW()::text),
  ('plan_pro',      '高级版', 'pro',      39200,  469900,  16300, 100,  2, '{"concurrent_tasks_per_seat":8,"canvas_collab":true,"shared_asset_library":true,"seat_management":true,"credit_quota_control":true,"fast_invoice":true}', 30, 1, NOW()::text, NOW()::text),
  ('plan_premium',  '豪华版', 'premium',  67500,  809900,  32800, 500,  2, '{"concurrent_tasks_per_seat":16,"canvas_collab":true,"shared_asset_library":true,"seat_management":true,"credit_quota_control":true,"fast_invoice":true}', 40, 1, NOW()::text, NOW()::text);
