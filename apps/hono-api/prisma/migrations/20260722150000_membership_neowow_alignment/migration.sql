BEGIN;

-- All DDL here is IF NOT EXISTS because these objects have two owners: this
-- migration, and `schema.sql` (applied by db:pg:schema, which runs BEFORE
-- db:pg:migrate in prepare-container-start.mjs). Whichever runs first wins and
-- the other must tolerate it; bare ADD COLUMN/CREATE would abort the migration
-- with "already exists", leaving a failed row in _prisma_migrations that blocks
-- every later migration with P3009 and takes the API down.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_team_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_cycle" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "monthly_credits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "daily_gift_credits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "concurrency_limit" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "capacity_label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "credit_grant_count" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "credit_grants_issued" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "next_credit_grant_at" TEXT;

CREATE INDEX IF NOT EXISTS "idx_subscriptions_membership_credit_due"
  ON "subscriptions"("status", "next_credit_grant_at");

CREATE TABLE IF NOT EXISTS "membership_credit_grants" (
  "id" TEXT PRIMARY KEY,
  "subscription_id" TEXT NOT NULL REFERENCES "subscriptions"("id") ON DELETE CASCADE,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id"),
  "team_id" TEXT NOT NULL REFERENCES "teams"("id"),
  "grant_type" TEXT NOT NULL,
  "grant_key" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "granted_at" TEXT NOT NULL,
  "expires_at" TEXT,
  "expired_amount" INTEGER NOT NULL DEFAULT 0,
  "processed_at" TEXT,
  CONSTRAINT "membership_credit_grants_subscription_type_key_key"
    UNIQUE ("subscription_id", "grant_type", "grant_key")
);

CREATE INDEX IF NOT EXISTS "idx_membership_credit_grants_owner_time"
  ON "membership_credit_grants"("owner_id", "granted_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_membership_credit_grants_team_time"
  ON "membership_credit_grants"("team_id", "granted_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_membership_credit_grants_expiry"
  ON "membership_credit_grants"("grant_type", "expires_at", "processed_at");

UPDATE "product_entitlements"
SET "entitlement_type" = 'membership', "updated_at" = NOW()::text
WHERE "entitlement_type" = 'monthly_quota';

UPDATE "product_skus" sku
SET "status" = 'inactive', "is_default" = 0, "updated_at" = NOW()::text
WHERE EXISTS (
  SELECT 1 FROM "product_entitlements" entitlement
  WHERE entitlement."product_id" = sku."product_id"
    AND entitlement."entitlement_type" = 'membership'
);

WITH membership_products AS (
  SELECT product."id" AS product_id, product."merchant_id", product."owner_id", GREATEST(product."stock", 1) AS stock,
    CASE
      WHEN UPPER(product."title") LIKE '%ULTRA%' THEN 'ultra'
      WHEN UPPER(product."title") LIKE '%PLUS%' THEN 'plus'
      WHEN UPPER(product."title") LIKE '%MAX%' THEN 'max'
      WHEN UPPER(TRIM(product."title")) ~ '(^|[^A-Z])PRO([^A-Z]|$)' THEN 'pro'
      ELSE NULL
    END AS tier
  FROM "products" product
  JOIN "product_entitlements" entitlement ON entitlement."product_id" = product."id"
  WHERE entitlement."entitlement_type" = 'membership'
), variants(tier, rank, suffix, name, spec, price_cents, billing_cycle, duration_days, monthly_credits, daily_gift_credits, concurrency_limit, capacity_label) AS (
  VALUES
    ('plus', 1, 'monthly', '月付', 'monthly', 8900, 'monthly', 30, 9900, 350, 6, ''),
    ('plus', 2, 'annual', '年付', 'annual', 94900, 'annual', 365, 10900, 500, 6, ''),
    ('pro', 1, 'monthly-64k', '月付 6.4w', 'monthly:6.4w', 26900, 'monthly', 30, 30900, 1100, 10, '6.4w'),
    ('pro', 2, 'monthly-91k', '月付 9.1w', 'monthly:9.1w', 37900, 'monthly', 30, 43500, 1570, 10, '9.1w'),
    ('pro', 3, 'monthly-117k', '月付 11.7w', 'monthly:11.7w', 48900, 'monthly', 30, 56200, 2030, 10, '11.7w'),
    ('pro', 4, 'monthly-143k', '月付 14.3w', 'monthly:14.3w', 59900, 'monthly', 30, 68800, 2490, 10, '14.3w'),
    ('pro', 5, 'annual-84k', '年付 8.4w', 'annual:8.4w', 290900, 'annual', 365, 36000, 1600, 10, '8.4w'),
    ('pro', 6, 'annual-118k', '年付 11.8w', 'annual:11.8w', 409900, 'annual', 365, 50700, 2250, 10, '11.8w'),
    ('pro', 7, 'annual-153k', '年付 15.3w', 'annual:15.3w', 529900, 'annual', 365, 65600, 2920, 10, '15.3w'),
    ('pro', 8, 'annual-188k', '年付 18.8w', 'annual:18.8w', 649900, 'annual', 365, 80400, 3580, 10, '18.8w'),
    ('max', 1, 'monthly', '月付', 'monthly', 62900, 'monthly', 30, 89000, 2800, 20, ''),
    ('max', 2, 'annual', '年付', 'annual', 679900, 'annual', 365, 108000, 4000, 20, ''),
    ('ultra', 1, 'monthly', '月付', 'monthly', 109900, 'monthly', 30, 155500, 4900, 30, ''),
    ('ultra', 2, 'annual', '年付', 'annual', 1189900, 'annual', 365, 189000, 7300, 30, '')
)
INSERT INTO "product_skus" (
  "id", "product_id", "owner_id", "merchant_id", "name", "spec", "price_cents", "stock", "is_default", "status", "created_at", "updated_at"
)
SELECT
  product.product_id || '-membership-' || variant.suffix,
  product.product_id,
  product.owner_id,
  product.merchant_id,
  variant.name,
  variant.spec,
  variant.price_cents,
  product.stock,
  CASE WHEN variant.rank = 1 THEN 1 ELSE 0 END,
  'active',
  NOW()::text,
  NOW()::text
FROM membership_products product
JOIN variants variant ON variant.tier = product.tier
WHERE product.tier IS NOT NULL
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "spec" = EXCLUDED."spec",
  "price_cents" = EXCLUDED."price_cents",
  "stock" = EXCLUDED."stock",
  "is_default" = EXCLUDED."is_default",
  "status" = 'active',
  "updated_at" = NOW()::text;

WITH membership_products AS (
  SELECT product."id" AS product_id,
    CASE
      WHEN UPPER(product."title") LIKE '%ULTRA%' THEN 'ultra'
      WHEN UPPER(product."title") LIKE '%PLUS%' THEN 'plus'
      WHEN UPPER(product."title") LIKE '%MAX%' THEN 'max'
      WHEN UPPER(TRIM(product."title")) ~ '(^|[^A-Z])PRO([^A-Z]|$)' THEN 'pro'
      ELSE NULL
    END AS tier
  FROM "products" product
  JOIN "product_entitlements" entitlement ON entitlement."product_id" = product."id"
  WHERE entitlement."entitlement_type" = 'membership'
), variants(tier, rank, suffix, price_cents, billing_cycle, duration_days, monthly_credits, daily_gift_credits, concurrency_limit, capacity_label) AS (
  VALUES
    ('plus', 1, 'monthly', 8900, 'monthly', 30, 9900, 350, 6, ''), ('plus', 2, 'annual', 94900, 'annual', 365, 10900, 500, 6, ''),
    ('pro', 1, 'monthly-64k', 26900, 'monthly', 30, 30900, 1100, 10, '6.4w'), ('pro', 2, 'monthly-91k', 37900, 'monthly', 30, 43500, 1570, 10, '9.1w'),
    ('pro', 3, 'monthly-117k', 48900, 'monthly', 30, 56200, 2030, 10, '11.7w'), ('pro', 4, 'monthly-143k', 59900, 'monthly', 30, 68800, 2490, 10, '14.3w'),
    ('pro', 5, 'annual-84k', 290900, 'annual', 365, 36000, 1600, 10, '8.4w'), ('pro', 6, 'annual-118k', 409900, 'annual', 365, 50700, 2250, 10, '11.8w'),
    ('pro', 7, 'annual-153k', 529900, 'annual', 365, 65600, 2920, 10, '15.3w'), ('pro', 8, 'annual-188k', 649900, 'annual', 365, 80400, 3580, 10, '18.8w'),
    ('max', 1, 'monthly', 62900, 'monthly', 30, 89000, 2800, 20, ''), ('max', 2, 'annual', 679900, 'annual', 365, 108000, 4000, 20, ''),
    ('ultra', 1, 'monthly', 109900, 'monthly', 30, 155500, 4900, 30, ''), ('ultra', 2, 'annual', 1189900, 'annual', 365, 189000, 7300, 30, '')
), configs AS (
  SELECT product.product_id, product.tier,
    jsonb_object_agg(
      product.product_id || '-membership-' || variant.suffix,
      jsonb_build_object(
        'billingCycle', variant.billing_cycle,
        'durationDays', variant.duration_days,
        'monthlyCredits', variant.monthly_credits,
        'dailyGiftCredits', variant.daily_gift_credits,
        'concurrencyLimit', variant.concurrency_limit,
        'capacityLabel', variant.capacity_label,
        'timezone', 'Asia/Shanghai'
      ) ORDER BY variant.rank
    ) AS sku_configs
  FROM membership_products product
  JOIN variants variant ON variant.tier = product.tier
  WHERE product.tier IS NOT NULL
  GROUP BY product.product_id, product.tier
)
UPDATE "product_entitlements" entitlement
SET "config_json" = jsonb_build_object(
  'billingCycle', first_variant.billing_cycle,
  'durationDays', first_variant.duration_days,
  'monthlyCredits', first_variant.monthly_credits,
  'dailyGiftCredits', first_variant.daily_gift_credits,
  'concurrencyLimit', first_variant.concurrency_limit,
  'capacityLabel', first_variant.capacity_label,
  'timezone', 'Asia/Shanghai',
  'skuConfigs', configs.sku_configs,
  'presentation', jsonb_build_object(
    'accent', CASE configs.tier WHEN 'pro' THEN 'violet' WHEN 'max' THEN 'blue' WHEN 'ultra' THEN 'cyan' ELSE 'graphite' END,
    'featured', configs.tier = 'pro',
    'sortOrder', CASE configs.tier WHEN 'plus' THEN 10 WHEN 'pro' THEN 20 WHEN 'max' THEN 30 ELSE 40 END,
    'campaignBenefits', jsonb_build_array('购买后立即获得本月积分', '每日赠送积分，当日有效', '全部创作功能'),
    'features', jsonb_build_array('全部图片、视频与音频模型', '无限画布与 Agents 协作', '角色、分镜与项目资产管理', 'Neo TV 发布与创作过程展示')
  )
)::text,
"updated_at" = NOW()::text
FROM configs
JOIN variants first_variant ON first_variant.tier = configs.tier AND first_variant.rank = 1
WHERE entitlement."product_id" = configs.product_id;

WITH tiers(tier, price_cents, subtitle) AS (
  VALUES
    ('plus', 8900, '每月 9,900 积分 + 每日赠送 350'),
    ('pro', 26900, '动态算力 6.4w–14.3w · 10 并发'),
    ('max', 62900, '每月 89,000 积分 + 每日赠送 2,800'),
    ('ultra', 109900, '每月 155,500 积分 + 每日赠送 4,900')
), membership_products AS (
  SELECT product."id",
    CASE
      WHEN UPPER(product."title") LIKE '%ULTRA%' THEN 'ultra'
      WHEN UPPER(product."title") LIKE '%PLUS%' THEN 'plus'
      WHEN UPPER(product."title") LIKE '%MAX%' THEN 'max'
      WHEN UPPER(TRIM(product."title")) ~ '(^|[^A-Z])PRO([^A-Z]|$)' THEN 'pro'
      ELSE NULL
    END AS tier
  FROM "products" product
  JOIN "product_entitlements" entitlement ON entitlement."product_id" = product."id"
  WHERE entitlement."entitlement_type" = 'membership'
)
UPDATE "products" product
SET "price_cents" = tiers.price_cents,
    "subtitle" = tiers.subtitle,
    "description" = '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能与套餐并发权益。',
    "updated_at" = NOW()::text
FROM membership_products membership_product
JOIN tiers ON tiers.tier = membership_product.tier
WHERE product."id" = membership_product."id";

COMMIT;
