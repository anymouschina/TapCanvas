-- TapCanvas Community hard cut: remove external payment/order persistence and
-- phone-code authentication. This migration intentionally does not delete
-- users, projects, generated assets, credit ledgers, redemption codes, or
-- administrator-managed subscriptions.

DROP TABLE IF EXISTS "payment_callbacks" CASCADE;
DROP TABLE IF EXISTS "payments" CASCADE;
DROP TABLE IF EXISTS "order_entitlements" CASCADE;
DROP TABLE IF EXISTS "order_status_events" CASCADE;
DROP TABLE IF EXISTS "order_items" CASCADE;
DROP TABLE IF EXISTS "team_subscription_fulfillments" CASCADE;
DROP TABLE IF EXISTS "orders" CASCADE;
DROP TABLE IF EXISTS "phone_login_codes" CASCADE;

ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "source_order_id";

ALTER TABLE "team_subscription_plans"
  DROP COLUMN IF EXISTS "price_monthly_cents",
  DROP COLUMN IF EXISTS "price_annual_cents",
  DROP COLUMN IF EXISTS "credits_per_seat_per_month";

ALTER TABLE "referral_config"
  DROP COLUMN IF EXISTS "first_recharge_bonus_credits",
  DROP COLUMN IF EXISTS "recharge_credits_per_yuan",
  DROP COLUMN IF EXISTS "min_recharge_yuan_for_bonus",
  DROP COLUMN IF EXISTS "total_cap_credits_per_referrer";

ALTER TABLE "referral_config"
  ALTER COLUMN "title" SET DEFAULT '邀请好友，注册赠送',
  ALTER COLUMN "body" SET DEFAULT '好友完成注册后获得欢迎额度';
