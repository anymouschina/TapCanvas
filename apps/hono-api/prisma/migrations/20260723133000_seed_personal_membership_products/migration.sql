-- Hard-cut the personal membership catalog to stable canonical IDs. Historical
-- products, SKUs and orders remain intact but are made inactive; active
-- subscriptions are rebound to the equivalent canonical SKU in this transaction.
BEGIN;

DO $$
DECLARE
  v_owner_id TEXT;
  v_merchant_id TEXT;
  v_owner_count INTEGER;
  v_conflicting_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT "owner_id"), MIN("owner_id")
  INTO v_owner_count, v_owner_id
  FROM "commerce_dictionaries"
  WHERE "dict_type" = 'platform_account'
    AND "code" = 'member_center';

  -- Not-configured-yet is not a conflict: the platform account is created at
  -- runtime by an admin, so a deployment awaiting setup has zero rows and no
  -- catalog to seed. Raising would leave a failed _prisma_migrations row and
  -- block every later migration with P3009, taking the API down over an
  -- unseeded storefront. Ambiguous ownership stays a hard error.
  IF v_owner_count = 0 OR v_owner_id IS NULL THEN
    RAISE NOTICE 'Skipping personal membership seed: no platform account configured yet (run again after setup)';
    RETURN;
  END IF;

  IF v_owner_count <> 1 THEN
    RAISE EXCEPTION 'Cannot seed personal memberships: platform account settings must identify exactly one owner (found %)', v_owner_count;
  END IF;

  SELECT "id"
  INTO v_merchant_id
  FROM "merchants"
  WHERE "owner_id" = v_owner_id
    AND "status" = 'active';

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed personal memberships: active platform merchant is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "products"
    WHERE "id" IN (
      'sys_membership_plus',
      'sys_membership_pro',
      'sys_membership_max',
      'sys_membership_ultra'
    )
      AND ("owner_id" <> v_owner_id OR "merchant_id" <> v_merchant_id)
  ) THEN
    RAISE EXCEPTION 'Cannot seed personal memberships: a canonical product ID belongs to another owner or merchant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "product_entitlements"
    WHERE "product_id" IN (
      'sys_membership_plus',
      'sys_membership_pro',
      'sys_membership_max',
      'sys_membership_ultra'
    )
      AND ("owner_id" <> v_owner_id OR "entitlement_type" <> 'membership')
  ) THEN
    RAISE EXCEPTION 'Cannot seed personal memberships: a canonical product has conflicting entitlement data';
  END IF;

  SELECT COUNT(*)
  INTO v_conflicting_count
  FROM "products" product
  JOIN "product_entitlements" entitlement
    ON entitlement."product_id" = product."id"
  WHERE product."owner_id" = v_owner_id
    AND product."status" = 'active'
    AND entitlement."entitlement_type" = 'membership'
    AND product."id" NOT IN (
      'sys_membership_plus',
      'sys_membership_pro',
      'sys_membership_max',
      'sys_membership_ultra'
    );

  IF v_conflicting_count > 0 THEN
    IF v_conflicting_count <> 4
      OR EXISTS (
        SELECT 1
        FROM "products" product
        JOIN "product_entitlements" entitlement
          ON entitlement."product_id" = product."id"
        WHERE product."owner_id" = v_owner_id
          AND product."status" = 'active'
          AND entitlement."entitlement_type" = 'membership'
          AND product."id" NOT IN (
            'sys_membership_plus',
            'sys_membership_pro',
            'sys_membership_max',
            'sys_membership_ultra'
          )
          AND UPPER(TRIM(product."title")) NOT IN ('PLUS', 'PRO', 'MAX', 'ULTRA')
      )
      OR (
        SELECT COUNT(DISTINCT UPPER(TRIM(product."title")))
        FROM "products" product
        JOIN "product_entitlements" entitlement
          ON entitlement."product_id" = product."id"
        WHERE product."owner_id" = v_owner_id
          AND product."status" = 'active'
          AND entitlement."entitlement_type" = 'membership'
          AND product."id" NOT IN (
            'sys_membership_plus',
            'sys_membership_pro',
            'sys_membership_max',
            'sys_membership_ultra'
          )
      ) <> 4 THEN
      RAISE EXCEPTION 'Cannot cut over personal memberships: expected one legacy PLUS/PRO/MAX/ULTRA product, found % active legacy product(s)', v_conflicting_count;
    END IF;

    UPDATE "product_skus" sku
    SET
      "status" = 'inactive',
      "is_default" = 0,
      "updated_at" = NOW()::TEXT
    WHERE sku."product_id" IN (
      SELECT product."id"
      FROM "products" product
      JOIN "product_entitlements" entitlement
        ON entitlement."product_id" = product."id"
      WHERE product."owner_id" = v_owner_id
        AND product."status" = 'active'
        AND entitlement."entitlement_type" = 'membership'
        AND product."id" NOT IN (
          'sys_membership_plus',
          'sys_membership_pro',
          'sys_membership_max',
          'sys_membership_ultra'
        )
    );

    UPDATE "products" product
    SET
      "status" = 'inactive',
      "updated_at" = NOW()::TEXT
    WHERE product."owner_id" = v_owner_id
      AND product."status" = 'active'
      AND product."id" NOT IN (
        'sys_membership_plus',
        'sys_membership_pro',
        'sys_membership_max',
        'sys_membership_ultra'
      )
      AND EXISTS (
        SELECT 1
        FROM "product_entitlements" entitlement
        WHERE entitlement."product_id" = product."id"
          AND entitlement."entitlement_type" = 'membership'
      );
  END IF;
END $$;

WITH platform AS (
  -- HAVING is required, not cosmetic: an unaggregated MIN() over zero matching
  -- rows still returns ONE row of NULLs, so `CROSS JOIN platform` below would
  -- yield a row and insert a NULL owner_id (violating NOT NULL). The DO block's
  -- RETURN above only exits that block — it cannot skip these statements. With
  -- HAVING the CTE is empty and every CROSS JOIN becomes a clean no-op.
  SELECT MIN(dictionary."owner_id") AS owner_id, MIN(merchant."id") AS merchant_id
  FROM "commerce_dictionaries" dictionary
  JOIN "merchants" merchant
    ON merchant."owner_id" = dictionary."owner_id"
    AND merchant."status" = 'active'
  WHERE dictionary."dict_type" = 'platform_account'
    AND dictionary."code" = 'member_center'
  HAVING MIN(dictionary."owner_id") IS NOT NULL
    AND MIN(merchant."id") IS NOT NULL
), tiers(id, tier, title, subtitle, price_cents, description) AS (
  VALUES
    ('sys_membership_plus', 'plus', 'PLUS', '每月 9,900 积分 + 每日赠送 350', 8900, '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能。'),
    ('sys_membership_pro', 'pro', 'PRO', '动态算力 6.4w-14.3w', 26900, '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能。'),
    ('sys_membership_max', 'max', 'MAX', '每月 89,000 积分 + 每日赠送 2,800', 62900, '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能。'),
    ('sys_membership_ultra', 'ultra', 'ULTRA', '每月 155,500 积分 + 每日赠送 4,900', 109900, '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能。')
)
INSERT INTO "products" (
  "id", "owner_id", "merchant_id", "title", "subtitle", "description",
  "currency", "price_cents", "stock", "status", "created_at", "updated_at"
)
SELECT
  tiers.id, platform.owner_id, platform.merchant_id, tiers.title, tiers.subtitle,
  tiers.description, 'CNY', tiers.price_cents, 999999, 'active', NOW()::text, NOW()::text
FROM tiers
CROSS JOIN platform
ON CONFLICT ("id") DO UPDATE SET
  "owner_id" = EXCLUDED."owner_id",
  "merchant_id" = EXCLUDED."merchant_id",
  "title" = EXCLUDED."title",
  "subtitle" = EXCLUDED."subtitle",
  "description" = EXCLUDED."description",
  "currency" = EXCLUDED."currency",
  "price_cents" = EXCLUDED."price_cents",
  "stock" = EXCLUDED."stock",
  "status" = EXCLUDED."status",
  "updated_at" = EXCLUDED."updated_at";

WITH platform AS (
  -- HAVING is required, not cosmetic: an unaggregated MIN() over zero matching
  -- rows still returns ONE row of NULLs, so `CROSS JOIN platform` below would
  -- yield a row and insert a NULL owner_id (violating NOT NULL). The DO block's
  -- RETURN above only exits that block — it cannot skip these statements. With
  -- HAVING the CTE is empty and every CROSS JOIN becomes a clean no-op.
  SELECT MIN(dictionary."owner_id") AS owner_id, MIN(merchant."id") AS merchant_id
  FROM "commerce_dictionaries" dictionary
  JOIN "merchants" merchant
    ON merchant."owner_id" = dictionary."owner_id"
    AND merchant."status" = 'active'
  WHERE dictionary."dict_type" = 'platform_account'
    AND dictionary."code" = 'member_center'
  HAVING MIN(dictionary."owner_id") IS NOT NULL
    AND MIN(merchant."id") IS NOT NULL
), variants(
  tier, rank, suffix, name, spec, price_cents, billing_cycle, duration_days,
  monthly_credits, daily_gift_credits, concurrency_limit, capacity_label
) AS (
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
), canonical_products(id, tier) AS (
  VALUES
    ('sys_membership_plus', 'plus'),
    ('sys_membership_pro', 'pro'),
    ('sys_membership_max', 'max'),
    ('sys_membership_ultra', 'ultra')
)
INSERT INTO "product_skus" (
  "id", "product_id", "owner_id", "merchant_id", "name", "spec",
  "price_cents", "stock", "is_default", "status", "created_at", "updated_at"
)
SELECT
  product.id || '-membership-' || variant.suffix,
  product.id,
  platform.owner_id,
  platform.merchant_id,
  variant.name,
  variant.spec,
  variant.price_cents,
  999999,
  CASE WHEN variant.rank = 1 THEN 1 ELSE 0 END,
  'active',
  NOW()::text,
  NOW()::text
FROM canonical_products product
JOIN variants variant ON variant.tier = product.tier
CROSS JOIN platform
ON CONFLICT ("id") DO UPDATE SET
  "product_id" = EXCLUDED."product_id",
  "owner_id" = EXCLUDED."owner_id",
  "merchant_id" = EXCLUDED."merchant_id",
  "name" = EXCLUDED."name",
  "spec" = EXCLUDED."spec",
  "price_cents" = EXCLUDED."price_cents",
  "stock" = EXCLUDED."stock",
  "is_default" = EXCLUDED."is_default",
  "status" = EXCLUDED."status",
  "updated_at" = EXCLUDED."updated_at";

WITH platform AS (
  -- Same reason as above: without HAVING, MIN() over zero rows yields one NULL
  -- row and the CROSS JOIN would insert a NULL owner_id.
  SELECT MIN(dictionary."owner_id") AS owner_id
  FROM "commerce_dictionaries" dictionary
  WHERE dictionary."dict_type" = 'platform_account'
    AND dictionary."code" = 'member_center'
  HAVING MIN(dictionary."owner_id") IS NOT NULL
), variants(
  tier, rank, suffix, billing_cycle, duration_days, monthly_credits,
  daily_gift_credits, concurrency_limit, capacity_label
) AS (
  VALUES
    ('plus', 1, 'monthly', 'monthly', 30, 9900, 350, 6, ''),
    ('plus', 2, 'annual', 'annual', 365, 10900, 500, 6, ''),
    ('pro', 1, 'monthly-64k', 'monthly', 30, 30900, 1100, 10, '6.4w'),
    ('pro', 2, 'monthly-91k', 'monthly', 30, 43500, 1570, 10, '9.1w'),
    ('pro', 3, 'monthly-117k', 'monthly', 30, 56200, 2030, 10, '11.7w'),
    ('pro', 4, 'monthly-143k', 'monthly', 30, 68800, 2490, 10, '14.3w'),
    ('pro', 5, 'annual-84k', 'annual', 365, 36000, 1600, 10, '8.4w'),
    ('pro', 6, 'annual-118k', 'annual', 365, 50700, 2250, 10, '11.8w'),
    ('pro', 7, 'annual-153k', 'annual', 365, 65600, 2920, 10, '15.3w'),
    ('pro', 8, 'annual-188k', 'annual', 365, 80400, 3580, 10, '18.8w'),
    ('max', 1, 'monthly', 'monthly', 30, 89000, 2800, 20, ''),
    ('max', 2, 'annual', 'annual', 365, 108000, 4000, 20, ''),
    ('ultra', 1, 'monthly', 'monthly', 30, 155500, 4900, 30, ''),
    ('ultra', 2, 'annual', 'annual', 365, 189000, 7300, 30, '')
), canonical_products(id, tier, accent, featured, sort_order) AS (
  VALUES
    ('sys_membership_plus', 'plus', 'graphite', FALSE, 10),
    ('sys_membership_pro', 'pro', 'violet', TRUE, 20),
    ('sys_membership_max', 'max', 'blue', FALSE, 30),
    ('sys_membership_ultra', 'ultra', 'cyan', FALSE, 40)
), configs AS (
  SELECT
    product.id AS product_id,
    product.tier,
    product.accent,
    product.featured,
    product.sort_order,
    jsonb_object_agg(
      product.id || '-membership-' || variant.suffix,
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
  FROM canonical_products product
  JOIN variants variant ON variant.tier = product.tier
  GROUP BY product.id, product.tier, product.accent, product.featured, product.sort_order
)
INSERT INTO "product_entitlements" (
  "id", "product_id", "owner_id", "entitlement_type", "config_json", "created_at", "updated_at"
)
SELECT
  config.product_id || '_ent',
  config.product_id,
  platform.owner_id,
  'membership',
  jsonb_build_object(
    'billingCycle', first_variant.billing_cycle,
    'durationDays', first_variant.duration_days,
    'monthlyCredits', first_variant.monthly_credits,
    'dailyGiftCredits', first_variant.daily_gift_credits,
    'concurrencyLimit', first_variant.concurrency_limit,
    'capacityLabel', first_variant.capacity_label,
    'timezone', 'Asia/Shanghai',
    'skuConfigs', config.sku_configs,
    'presentation', jsonb_build_object(
      'accent', config.accent,
      'featured', config.featured,
      'sortOrder', config.sort_order,
      'campaignBenefits', jsonb_build_array(
        '购买后立即获得本月积分',
        '每日赠送积分，当日有效',
        '全部创作功能'
      ),
      'features', jsonb_build_array(
        '全部图片、视频与音频模型',
        '无限画布与 Agents 协作',
        '角色、分镜与项目资产管理',
        'Neo TV 发布与创作过程展示'
      )
    )
  )::text,
  NOW()::text,
  NOW()::text
FROM configs config
JOIN variants first_variant
  ON first_variant.tier = config.tier
  AND first_variant.rank = 1
CROSS JOIN platform
ON CONFLICT ("id") DO UPDATE SET
  "product_id" = EXCLUDED."product_id",
  "owner_id" = EXCLUDED."owner_id",
  "entitlement_type" = EXCLUDED."entitlement_type",
  "config_json" = EXCLUDED."config_json",
  "updated_at" = EXCLUDED."updated_at";

WITH tier_map(legacy_title, tier, canonical_product_id) AS (
  VALUES
    ('PLUS', 'plus', 'sys_membership_plus'),
    ('PRO', 'pro', 'sys_membership_pro'),
    ('MAX', 'max', 'sys_membership_max'),
    ('ULTRA', 'ultra', 'sys_membership_ultra')
), sku_map(tier, legacy_spec, canonical_suffix) AS (
  VALUES
    ('plus', 'monthly', 'monthly'),
    ('plus', 'annual', 'annual'),
    ('pro', 'monthly:6.4w', 'monthly-64k'),
    ('pro', 'monthly:9.1w', 'monthly-91k'),
    ('pro', 'monthly:11.7w', 'monthly-117k'),
    ('pro', 'monthly:14.3w', 'monthly-143k'),
    ('pro', 'annual:8.4w', 'annual-84k'),
    ('pro', 'annual:11.8w', 'annual-118k'),
    ('pro', 'annual:15.3w', 'annual-153k'),
    ('pro', 'annual:18.8w', 'annual-188k'),
    ('max', 'monthly', 'monthly'),
    ('max', 'annual', 'annual'),
    ('ultra', 'monthly', 'monthly'),
    ('ultra', 'annual', 'annual')
), legacy_subscription_map AS (
  SELECT
    subscription."id" AS subscription_id,
    'membership:' || tier_map.canonical_product_id || ':' ||
      tier_map.canonical_product_id || '-membership-' || sku_map.canonical_suffix AS canonical_plan_code
  FROM "subscriptions" subscription
  JOIN "products" legacy_product
    ON legacy_product."id" = split_part(subscription."plan_code", ':', 2)
  JOIN "product_skus" legacy_sku
    ON legacy_sku."id" = split_part(subscription."plan_code", ':', 3)
    AND legacy_sku."product_id" = legacy_product."id"
  JOIN tier_map
    ON tier_map.legacy_title = UPPER(TRIM(legacy_product."title"))
  JOIN sku_map
    ON sku_map.tier = tier_map.tier
    AND sku_map.legacy_spec = legacy_sku."spec"
  WHERE subscription."status" = 'active'
    AND split_part(subscription."plan_code", ':', 1) = 'membership'
    AND legacy_product."id" NOT IN (
      'sys_membership_plus',
      'sys_membership_pro',
      'sys_membership_max',
      'sys_membership_ultra'
    )
)
UPDATE "subscriptions" subscription
SET
  "plan_code" = mapping.canonical_plan_code,
  "updated_at" = NOW()::TEXT
FROM legacy_subscription_map mapping
WHERE subscription."id" = mapping.subscription_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "subscriptions" subscription
    JOIN "products" product
      ON product."id" = split_part(subscription."plan_code", ':', 2)
    JOIN "product_entitlements" entitlement
      ON entitlement."product_id" = product."id"
      AND entitlement."entitlement_type" = 'membership'
    WHERE subscription."status" = 'active'
      AND split_part(subscription."plan_code", ':', 1) = 'membership'
      AND product."id" NOT IN (
        'sys_membership_plus',
        'sys_membership_pro',
        'sys_membership_max',
        'sys_membership_ultra'
      )
  ) THEN
    RAISE EXCEPTION 'Cannot cut over personal memberships: an active legacy subscription could not be mapped to a canonical SKU';
  END IF;
END $$;

COMMIT;
