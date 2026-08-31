-- Hard cutover from 10 credits/CNY to 100 credits/CNY.
-- Every stored credit amount is rebased by the same factor, so RMB purchasing
-- power is unchanged. This migration must run exactly once through Prisma.
BEGIN;

UPDATE "teams"
SET
  "credits" = "credits" * 10,
  "credits_frozen" = "credits_frozen" * 10,
  "updated_at" = NOW()::text;

UPDATE "team_credit_ledger"
SET "amount" = "amount" * 10;

UPDATE "points_accounts"
SET
  "balance" = "balance" * 10,
  "total_earned" = "total_earned" * 10,
  "total_spent" = "total_spent" * 10,
  "updated_at" = NOW()::text;

UPDATE "points_ledger"
SET
  "change_amount" = "change_amount" * 10,
  "balance_after" = "balance_after" * 10;

UPDATE "model_credit_costs"
SET
  "cost" = "cost" * 10,
  "updated_at" = NOW()::text;

UPDATE "model_credit_cost_specs"
SET
  "cost" = "cost" * 10,
  "updated_at" = NOW()::text;

UPDATE "team_subscription_plans"
SET
  "credits_per_seat_per_month" = "credits_per_seat_per_month" * 10,
  "updated_at" = NOW()::text;

UPDATE "team_plan_subscriptions"
SET
  "credits_per_renewal" = "credits_per_renewal" * 10,
  "updated_at" = NOW()::text;

UPDATE "referral_config"
SET
  "first_recharge_bonus_credits" = "first_recharge_bonus_credits" * 10,
  "recharge_credits_per_yuan" = "recharge_credits_per_yuan" * 10,
  "total_cap_credits_per_referrer" = "total_cap_credits_per_referrer" * 10,
  "invitee_welcome_credits" = "invitee_welcome_credits" * 10,
  "updated_at" = NOW()::text;

ALTER TABLE "referral_config"
  ALTER COLUMN "first_recharge_bonus_credits" SET DEFAULT 500,
  ALTER COLUMN "recharge_credits_per_yuan" SET DEFAULT 5,
  ALTER COLUMN "total_cap_credits_per_referrer" SET DEFAULT 1000000,
  ALTER COLUMN "invitee_welcome_credits" SET DEFAULT 1000;

UPDATE "referral_grant_log"
SET "granted_credits" = "granted_credits" * 10;

UPDATE "product_entitlements"
SET
  "config_json" = jsonb_set(
    jsonb_set(
      "config_json"::jsonb,
      '{points}',
      to_jsonb((("config_json"::jsonb ->> 'points')::bigint * 10)),
      false
    ),
    '{bonusPoints}',
    to_jsonb((COALESCE(("config_json"::jsonb ->> 'bonusPoints')::bigint, 0) * 10)),
    true
  )::text,
  "updated_at" = NOW()::text
WHERE "entitlement_type" = 'points_topup'
  AND "config_json" IS NOT NULL
  AND "config_json"::jsonb ? 'points';

UPDATE "products" AS product
SET
  "subtitle" = CASE
    WHEN COALESCE((entitlement."config_json"::jsonb ->> 'bonusPoints')::bigint, 0) > 0
      THEN (entitlement."config_json"::jsonb ->> 'points') || ' 积分 + 赠 ' ||
        (entitlement."config_json"::jsonb ->> 'bonusPoints')
    ELSE (entitlement."config_json"::jsonb ->> 'points') || ' 积分'
  END,
  "updated_at" = NOW()::text
FROM "product_entitlements" AS entitlement
WHERE entitlement."product_id" = product."id"
  AND entitlement."entitlement_type" = 'points_topup'
  AND entitlement."config_json" IS NOT NULL
  AND entitlement."config_json"::jsonb ? 'points';

UPDATE "product_entitlements"
SET
  "config_json" = jsonb_set(
    "config_json"::jsonb,
    '{credits_per_seat_year}',
    to_jsonb((("config_json"::jsonb ->> 'credits_per_seat_year')::bigint * 10)),
    false
  )::text,
  "updated_at" = NOW()::text
WHERE "entitlement_type" = 'team_plan'
  AND "config_json" IS NOT NULL
  AND "config_json"::jsonb ? 'credits_per_seat_year';

UPDATE "products" AS product
SET
  "description" = '每席每月赠 ' ||
    (((entitlement."config_json"::jsonb ->> 'credits_per_seat_year')::bigint / 12)::text) ||
    ' 积分，年付享折扣',
  "updated_at" = NOW()::text
FROM "product_entitlements" AS entitlement
WHERE entitlement."product_id" = product."id"
  AND entitlement."entitlement_type" = 'team_plan'
  AND entitlement."config_json" IS NOT NULL
  AND entitlement."config_json"::jsonb ? 'credits_per_seat_year';

-- Skill marketplace stores its credit price in products.price_cents by design.
UPDATE "products" AS product
SET
  "price_cents" = product."price_cents" * 10,
  "updated_at" = NOW()::text
WHERE EXISTS (
  SELECT 1
  FROM "product_entitlements" AS entitlement
  WHERE entitlement."product_id" = product."id"
    AND entitlement."entitlement_type" = 'skill_license'
);

UPDATE "product_skus" AS sku
SET
  "price_cents" = sku."price_cents" * 10,
  "updated_at" = NOW()::text
WHERE EXISTS (
  SELECT 1
  FROM "product_entitlements" AS entitlement
  WHERE entitlement."product_id" = sku."product_id"
    AND entitlement."entitlement_type" = 'skill_license'
);

UPDATE "commerce_dictionaries"
SET
  "value_json" = jsonb_set(
    "value_json"::jsonb,
    '{checkInRewardCredits}',
    to_jsonb((("value_json"::jsonb ->> 'checkInRewardCredits')::bigint * 10)),
    false
  )::text,
  "updated_at" = NOW()::text
WHERE "dict_type" = 'platform_account'
  AND "code" = 'member_center'
  AND "value_json" IS NOT NULL
  AND "value_json"::jsonb ? 'checkInRewardCredits';

COMMIT;
