-- Personal membership enforcement is temporarily disabled. Keep ULTRA catalog
-- metadata and already-active ULTRA subscriptions at the schema's practical
-- unlimited value until the dormant concurrency field is removed separately.
BEGIN;

DO $$
DECLARE
  v_config JSONB;
BEGIN
  SELECT "config_json"::JSONB
  INTO v_config
  FROM "product_entitlements"
  WHERE "product_id" = 'sys_membership_ultra'
    AND "entitlement_type" = 'membership';

  -- The canonical entitlement is created by 20260723133000, which legitimately
  -- skips when no platform account is configured yet. In that case there is no
  -- ULTRA catalog to adjust, so absence is "nothing to do", not a conflict —
  -- raising would leave a failed _prisma_migrations row and block every later
  -- migration with P3009. The UPDATEs below are no-ops when the rows are absent.
  IF v_config IS NULL THEN
    RAISE NOTICE 'Skipping ULTRA concurrency raise: canonical membership entitlement not seeded yet';
    RETURN;
  END IF;

  IF v_config #> '{skuConfigs,sys_membership_ultra-membership-monthly}' IS NULL
    OR v_config #> '{skuConfigs,sys_membership_ultra-membership-annual}' IS NULL THEN
    RAISE NOTICE 'Skipping ULTRA concurrency raise: canonical monthly/annual SKU config not seeded yet';
    RETURN;
  END IF;
END $$;

UPDATE "product_entitlements"
SET
  "config_json" = jsonb_set(
    jsonb_set(
      jsonb_set(
        "config_json"::JSONB,
        '{concurrencyLimit}',
        '1000'::JSONB,
        FALSE
      ),
      '{skuConfigs,sys_membership_ultra-membership-monthly,concurrencyLimit}',
      '1000'::JSONB,
      FALSE
    ),
    '{skuConfigs,sys_membership_ultra-membership-annual,concurrencyLimit}',
    '1000'::JSONB,
    FALSE
  )::TEXT,
  "updated_at" = NOW()::TEXT
WHERE "product_id" = 'sys_membership_ultra'
  AND "entitlement_type" = 'membership';

UPDATE "subscriptions"
SET
  "concurrency_limit" = 1000,
  "updated_at" = NOW()::TEXT
WHERE "status" = 'active'
  AND split_part("plan_code", ':', 2) = 'sys_membership_ultra';

COMMIT;
