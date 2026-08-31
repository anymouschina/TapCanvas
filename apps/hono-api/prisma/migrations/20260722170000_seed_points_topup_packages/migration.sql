-- Seed the canonical TapCanvas points top-up catalog at 100 base credits/CNY.
-- Platform ownership is derived from the persisted platform account settings
-- written under COMMERCE_PLATFORM_OWNER_ID. Conflicting catalog data fails in place.
BEGIN;

DO $$
DECLARE
  v_owner_id TEXT;
  v_merchant_id TEXT;
  v_now TEXT;
  v_platform_owner_count INTEGER;
  v_conflicting_count INTEGER;
BEGIN
  v_now := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  SELECT COUNT(DISTINCT "owner_id"), MIN("owner_id")
  INTO v_platform_owner_count, v_owner_id
  FROM "commerce_dictionaries"
  WHERE "dict_type" = 'platform_account'
    AND "code" = 'member_center';

  -- "Not configured yet" and "conflicting data" are different failures. The
  -- platform account is created at runtime by an admin (platform_account /
  -- member_center in commerce_dictionaries), so a deployment that has not been
  -- set up yet legitimately has zero rows — there is simply no catalog to seed.
  -- Raising here would leave a failed row in _prisma_migrations and block every
  -- later migration with P3009, taking the whole API down over an unseeded
  -- storefront. Skip instead; a later run seeds it once the admin configures it.
  -- Ambiguous ownership (more than one owner) stays a hard error.
  IF v_platform_owner_count = 0 OR v_owner_id IS NULL THEN
    RAISE NOTICE 'Skipping points top-up seed: no platform account configured yet (run again after setup)';
    RETURN;
  END IF;

  IF v_platform_owner_count <> 1 THEN
    RAISE EXCEPTION 'Cannot seed points top-up packages: platform account settings must identify exactly one owner (found %)', v_platform_owner_count;
  END IF;

  SELECT "id"
  INTO v_merchant_id
  FROM "merchants"
  WHERE "owner_id" = v_owner_id;

  IF v_merchant_id IS NULL THEN
    v_merchant_id := gen_random_uuid()::TEXT;
    INSERT INTO "merchants" (
      "id", "owner_id", "name", "status", "created_at", "updated_at"
    )
    VALUES (
      v_merchant_id, v_owner_id, 'TapCanvas 平台', 'active', v_now, v_now
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "products"
    WHERE "id" IN (
      'sys_points_topup_10',
      'sys_points_topup_50',
      'sys_points_topup_100',
      'sys_points_topup_300'
    )
      AND "owner_id" <> v_owner_id
  ) THEN
    RAISE EXCEPTION 'Cannot seed points top-up packages: a canonical product ID belongs to another owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "product_entitlements"
    WHERE "product_id" IN (
      'sys_points_topup_10',
      'sys_points_topup_50',
      'sys_points_topup_100',
      'sys_points_topup_300'
    )
      AND (
        "owner_id" <> v_owner_id
        OR "entitlement_type" <> 'points_topup'
      )
  ) THEN
    RAISE EXCEPTION 'Cannot seed points top-up packages: a canonical product has conflicting entitlement data';
  END IF;

  SELECT COUNT(*)
  INTO v_conflicting_count
  FROM "products" AS product
  JOIN "product_entitlements" AS entitlement
    ON entitlement."product_id" = product."id"
    AND entitlement."owner_id" = product."owner_id"
  WHERE product."owner_id" = v_owner_id
    AND product."status" = 'active'
    AND entitlement."entitlement_type" = 'points_topup'
    AND product."id" NOT IN (
      'sys_points_topup_10',
      'sys_points_topup_50',
      'sys_points_topup_100',
      'sys_points_topup_300'
    );

  IF v_conflicting_count > 0 THEN
    RAISE EXCEPTION 'Cannot seed points top-up packages: % non-canonical active package(s) already exist', v_conflicting_count;
  END IF;

  INSERT INTO "products" (
    "id",
    "owner_id",
    "merchant_id",
    "title",
    "subtitle",
    "description",
    "currency",
    "price_cents",
    "stock",
    "status",
    "created_at",
    "updated_at"
  )
  VALUES
    (
      'sys_points_topup_10', v_owner_id, v_merchant_id,
      '充值 10 元', '1,000 积分', '基础积分充值套餐',
      'CNY', 1000, 999999, 'active', v_now, v_now
    ),
    (
      'sys_points_topup_50', v_owner_id, v_merchant_id,
      '充值 50 元', '5,000 积分 + 赠 500', '含 500 赠送积分',
      'CNY', 5000, 999999, 'active', v_now, v_now
    ),
    (
      'sys_points_topup_100', v_owner_id, v_merchant_id,
      '充值 100 元', '10,000 积分 + 赠 1,500', '含 1,500 赠送积分',
      'CNY', 10000, 999999, 'active', v_now, v_now
    ),
    (
      'sys_points_topup_300', v_owner_id, v_merchant_id,
      '充值 300 元', '30,000 积分 + 赠 6,000', '含 6,000 赠送积分',
      'CNY', 30000, 999999, 'active', v_now, v_now
    )
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

  INSERT INTO "product_entitlements" (
    "id",
    "product_id",
    "owner_id",
    "entitlement_type",
    "config_json",
    "created_at",
    "updated_at"
  )
  VALUES
    (
      'sys_points_topup_10_ent', 'sys_points_topup_10', v_owner_id,
      'points_topup', '{"points":1000,"bonusPoints":0}', v_now, v_now
    ),
    (
      'sys_points_topup_50_ent', 'sys_points_topup_50', v_owner_id,
      'points_topup', '{"points":5000,"bonusPoints":500}', v_now, v_now
    ),
    (
      'sys_points_topup_100_ent', 'sys_points_topup_100', v_owner_id,
      'points_topup', '{"points":10000,"bonusPoints":1500}', v_now, v_now
    ),
    (
      'sys_points_topup_300_ent', 'sys_points_topup_300', v_owner_id,
      'points_topup', '{"points":30000,"bonusPoints":6000}', v_now, v_now
    )
  ON CONFLICT ("owner_id", "product_id") DO UPDATE SET
    "entitlement_type" = EXCLUDED."entitlement_type",
    "config_json" = EXCLUDED."config_json",
    "updated_at" = EXCLUDED."updated_at";
END $$;

COMMIT;
