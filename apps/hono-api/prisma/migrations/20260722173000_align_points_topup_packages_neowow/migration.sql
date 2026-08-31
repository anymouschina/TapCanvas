-- Correct environments where an earlier version of the points top-up seed was
-- already recorded as applied. This migration is intentionally self-contained
-- and idempotent because Prisma migrations are immutable deployment records.
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

  -- Not-configured-yet is not a conflict: the platform account is created at
  -- runtime by an admin, so a deployment awaiting setup has zero rows and no
  -- catalog to align. Raising would leave a failed _prisma_migrations row and
  -- block every later migration with P3009, taking the API down over an
  -- unseeded storefront. Ambiguous ownership stays a hard error.
  IF v_platform_owner_count = 0 OR v_owner_id IS NULL THEN
    RAISE NOTICE 'Skipping points top-up alignment: no platform account configured yet (run again after setup)';
    RETURN;
  END IF;

  IF v_platform_owner_count <> 1 THEN
    RAISE EXCEPTION 'Cannot align points top-up packages: platform account settings must identify exactly one owner (found %)', v_platform_owner_count;
  END IF;

  SELECT "id"
  INTO v_merchant_id
  FROM "merchants"
  WHERE "owner_id" = v_owner_id
  ORDER BY "created_at" ASC
  LIMIT 1;

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
      'sys_points_topup_50',
      'sys_points_topup_100',
      'sys_points_topup_200',
      'sys_points_topup_500',
      'sys_points_topup_1000',
      'sys_points_topup_2000',
      'sys_points_topup_5000',
      'sys_points_topup_10000',
      'sys_points_topup_20000'
    )
      AND "owner_id" NOT IN (v_owner_id, 'platform_tapcanvas')
  ) THEN
    RAISE EXCEPTION 'Cannot align points top-up packages: a canonical product ID belongs to another owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "product_entitlements"
    WHERE "product_id" IN (
      'sys_points_topup_50',
      'sys_points_topup_100',
      'sys_points_topup_200',
      'sys_points_topup_500',
      'sys_points_topup_1000',
      'sys_points_topup_2000',
      'sys_points_topup_5000',
      'sys_points_topup_10000',
      'sys_points_topup_20000'
    )
      AND (
        "owner_id" NOT IN (v_owner_id, 'platform_tapcanvas')
        OR "entitlement_type" <> 'points_topup'
      )
  ) THEN
    RAISE EXCEPTION 'Cannot align points top-up packages: a canonical product has conflicting entitlement data';
  END IF;

  -- The first canonical seed used the legacy platform account. Only those
  -- known platform-owned records may move to the configured platform owner.
  UPDATE "products"
  SET
    "owner_id" = v_owner_id,
    "merchant_id" = v_merchant_id,
    "updated_at" = v_now
  WHERE "owner_id" = 'platform_tapcanvas'
    AND "id" IN (
      'sys_points_topup_50',
      'sys_points_topup_100',
      'sys_points_topup_200',
      'sys_points_topup_500',
      'sys_points_topup_1000',
      'sys_points_topup_2000',
      'sys_points_topup_5000',
      'sys_points_topup_10000',
      'sys_points_topup_20000'
    );

  UPDATE "product_entitlements"
  SET "owner_id" = v_owner_id, "updated_at" = v_now
  WHERE "owner_id" = 'platform_tapcanvas'
    AND "product_id" IN (
      'sys_points_topup_50',
      'sys_points_topup_100',
      'sys_points_topup_200',
      'sys_points_topup_500',
      'sys_points_topup_1000',
      'sys_points_topup_2000',
      'sys_points_topup_5000',
      'sys_points_topup_10000',
      'sys_points_topup_20000'
    );

  UPDATE "products"
  SET "status" = 'inactive', "updated_at" = v_now
  WHERE "owner_id" = v_owner_id
    AND "id" IN (
      'prod_recharge_10',
      'prod_recharge_50',
      'prod_recharge_100',
      'prod_recharge_300',
      'sys_points_topup_10',
      'sys_points_topup_300'
    );

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
      'sys_points_topup_50',
      'sys_points_topup_100',
      'sys_points_topup_200',
      'sys_points_topup_500',
      'sys_points_topup_1000',
      'sys_points_topup_2000',
      'sys_points_topup_5000',
      'sys_points_topup_10000',
      'sys_points_topup_20000'
    );

  IF v_conflicting_count > 0 THEN
    RAISE EXCEPTION 'Cannot align points top-up packages: % non-canonical active package(s) already exist', v_conflicting_count;
  END IF;

  INSERT INTO "products" (
    "id", "owner_id", "merchant_id", "title", "subtitle", "description",
    "currency", "price_cents", "stock", "status", "created_at", "updated_at"
  )
  VALUES
    ('sys_points_topup_50', v_owner_id, v_merchant_id, '充值 50 元', '5,000 积分 + 赠 150', '阶梯赠送 3%，年会员额外赠 250', 'CNY', 5000, 999999, 'active', v_now, v_now),
    ('sys_points_topup_100', v_owner_id, v_merchant_id, '充值 100 元', '10,000 积分 + 赠 300', '阶梯赠送 3%，年会员额外赠 500', 'CNY', 10000, 999999, 'active', v_now, v_now),
    ('sys_points_topup_200', v_owner_id, v_merchant_id, '充值 200 元', '20,000 积分 + 赠 800', '阶梯赠送 4%，年会员额外赠 1,000', 'CNY', 20000, 999999, 'active', v_now, v_now),
    ('sys_points_topup_500', v_owner_id, v_merchant_id, '充值 500 元', '50,000 积分 + 赠 2,500', '阶梯赠送 5%，年会员额外赠 2,500', 'CNY', 50000, 999999, 'active', v_now, v_now),
    ('sys_points_topup_1000', v_owner_id, v_merchant_id, '充值 1,000 元', '100,000 积分 + 赠 6,000', '阶梯赠送 6%，年会员额外赠 5,000', 'CNY', 100000, 999999, 'active', v_now, v_now),
    ('sys_points_topup_2000', v_owner_id, v_merchant_id, '充值 2,000 元', '200,000 积分 + 赠 14,000', '阶梯赠送 7%，年会员额外赠 10,000', 'CNY', 200000, 999999, 'active', v_now, v_now),
    ('sys_points_topup_5000', v_owner_id, v_merchant_id, '充值 5,000 元', '500,000 积分 + 赠 40,000', '阶梯赠送 8%，年会员额外赠 25,000', 'CNY', 500000, 999999, 'active', v_now, v_now),
    ('sys_points_topup_10000', v_owner_id, v_merchant_id, '充值 10,000 元', '1,000,000 积分 + 赠 90,000', '阶梯赠送 9%，年会员额外赠 50,000', 'CNY', 1000000, 999999, 'active', v_now, v_now),
    ('sys_points_topup_20000', v_owner_id, v_merchant_id, '充值 20,000 元', '2,000,000 积分 + 赠 200,000', '阶梯赠送 10%，年会员额外赠 100,000', 'CNY', 2000000, 999999, 'active', v_now, v_now)
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
    "id", "product_id", "owner_id", "entitlement_type", "config_json", "created_at", "updated_at"
  )
  VALUES
    ('sys_points_topup_50_ent', 'sys_points_topup_50', v_owner_id, 'points_topup', '{"points":5000,"bonusPoints":150,"annualMemberBonusPoints":250}', v_now, v_now),
    ('sys_points_topup_100_ent', 'sys_points_topup_100', v_owner_id, 'points_topup', '{"points":10000,"bonusPoints":300,"annualMemberBonusPoints":500}', v_now, v_now),
    ('sys_points_topup_200_ent', 'sys_points_topup_200', v_owner_id, 'points_topup', '{"points":20000,"bonusPoints":800,"annualMemberBonusPoints":1000}', v_now, v_now),
    ('sys_points_topup_500_ent', 'sys_points_topup_500', v_owner_id, 'points_topup', '{"points":50000,"bonusPoints":2500,"annualMemberBonusPoints":2500}', v_now, v_now),
    ('sys_points_topup_1000_ent', 'sys_points_topup_1000', v_owner_id, 'points_topup', '{"points":100000,"bonusPoints":6000,"annualMemberBonusPoints":5000}', v_now, v_now),
    ('sys_points_topup_2000_ent', 'sys_points_topup_2000', v_owner_id, 'points_topup', '{"points":200000,"bonusPoints":14000,"annualMemberBonusPoints":10000}', v_now, v_now),
    ('sys_points_topup_5000_ent', 'sys_points_topup_5000', v_owner_id, 'points_topup', '{"points":500000,"bonusPoints":40000,"annualMemberBonusPoints":25000}', v_now, v_now),
    ('sys_points_topup_10000_ent', 'sys_points_topup_10000', v_owner_id, 'points_topup', '{"points":1000000,"bonusPoints":90000,"annualMemberBonusPoints":50000}', v_now, v_now),
    ('sys_points_topup_20000_ent', 'sys_points_topup_20000', v_owner_id, 'points_topup', '{"points":2000000,"bonusPoints":200000,"annualMemberBonusPoints":100000}', v_now, v_now)
  ON CONFLICT ("owner_id", "product_id") DO UPDATE SET
    "entitlement_type" = EXCLUDED."entitlement_type",
    "config_json" = EXCLUDED."config_json",
    "updated_at" = EXCLUDED."updated_at";
END $$;

COMMIT;
