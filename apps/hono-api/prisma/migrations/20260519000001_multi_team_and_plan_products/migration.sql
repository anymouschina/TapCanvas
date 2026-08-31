-- 移除单团队唯一索引限制，支持多团队
DROP INDEX IF EXISTS "idx_team_memberships_user_id";

-- 重建普通（非唯一）索引，保持查询性能
CREATE INDEX IF NOT EXISTS "idx_team_memberships_user_id"
  ON "team_memberships"("user_id");

-- 团队套餐产品：插入 4 个基础套餐（使用 DO $$ 块避免重复插入）
DO $$
DECLARE
  v_owner_id  TEXT;
  v_merchant_id TEXT;
  v_now  TEXT;
  -- 固定产品 ID（方便幂等重跑）
  p_std      TEXT := 'sys_team_plan_standard';
  p_pro      TEXT := 'sys_team_plan_pro';
  p_premium  TEXT := 'sys_team_plan_premium';
  p_ultimate TEXT := 'sys_team_plan_ultimate';
BEGIN
  v_now := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  -- 取第一个用户作为系统 owner（上线后可换真正管理员 ID）
  SELECT id INTO v_owner_id FROM users ORDER BY created_at ASC LIMIT 1;
  IF v_owner_id IS NULL THEN RETURN; END IF;

  -- 取或创建系统 merchant
  SELECT id INTO v_merchant_id FROM merchants WHERE owner_id = v_owner_id LIMIT 1;
  IF v_merchant_id IS NULL THEN
    v_merchant_id := gen_random_uuid()::TEXT;
    INSERT INTO merchants (id, owner_id, name, created_at, updated_at)
    VALUES (v_merchant_id, v_owner_id, '平台系统', v_now, v_now)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_merchant_id FROM merchants WHERE owner_id = v_owner_id LIMIT 1;
  END IF;

  -- ── 标准版 ──────────────────────────────────────────────
  INSERT INTO products (id, owner_id, merchant_id, title, subtitle, description,
    currency, price_cents, stock, status, created_at, updated_at)
  VALUES (p_std, v_owner_id, v_merchant_id,
    '团队标准版', '协作团队入门套餐', '每席每月赠 1500 积分，年付享折扣',
    'CNY', 72900, 9999, 'active', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO product_entitlements (id, product_id, owner_id, entitlement_type, config_json, created_at, updated_at)
  VALUES (p_std || '_ent', p_std, v_owner_id, 'team_plan',
    '{"plan_tier":"standard","credits_per_seat_year":18000,"price_per_seat_cents":72900}',
    v_now, v_now)
  ON CONFLICT (owner_id, product_id) DO NOTHING;

  -- 标准版 SKU：2/3/4/5/6/8/10 席
  INSERT INTO product_skus (id, product_id, owner_id, merchant_id, name, spec, price_cents, stock, is_default, status, created_at, updated_at)
  VALUES
    (p_std||'_s2',  p_std, v_owner_id, v_merchant_id, '2 席位', '2席/年', 72900*2,  9999, 1, 'active', v_now, v_now),
    (p_std||'_s3',  p_std, v_owner_id, v_merchant_id, '3 席位', '3席/年', 72900*3,  9999, 0, 'active', v_now, v_now),
    (p_std||'_s4',  p_std, v_owner_id, v_merchant_id, '4 席位', '4席/年', 72900*4,  9999, 0, 'active', v_now, v_now),
    (p_std||'_s5',  p_std, v_owner_id, v_merchant_id, '5 席位', '5席/年', 72900*5,  9999, 0, 'active', v_now, v_now),
    (p_std||'_s6',  p_std, v_owner_id, v_merchant_id, '6 席位', '6席/年', 72900*6,  9999, 0, 'active', v_now, v_now),
    (p_std||'_s8',  p_std, v_owner_id, v_merchant_id, '8 席位', '8席/年', 72900*8,  9999, 0, 'active', v_now, v_now),
    (p_std||'_s10', p_std, v_owner_id, v_merchant_id, '10 席位','10席/年',72900*10, 9999, 0, 'active', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

  -- ── 进阶版 ──────────────────────────────────────────────
  INSERT INTO products (id, owner_id, merchant_id, title, subtitle, description,
    currency, price_cents, stock, status, created_at, updated_at)
  VALUES (p_pro, v_owner_id, v_merchant_id,
    '团队进阶版', '高效协作套餐', '每席每月赠 4600 积分，年付享折扣',
    'CNY', 134900, 9999, 'active', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO product_entitlements (id, product_id, owner_id, entitlement_type, config_json, created_at, updated_at)
  VALUES (p_pro || '_ent', p_pro, v_owner_id, 'team_plan',
    '{"plan_tier":"pro","credits_per_seat_year":55200,"price_per_seat_cents":134900}',
    v_now, v_now)
  ON CONFLICT (owner_id, product_id) DO NOTHING;

  INSERT INTO product_skus (id, product_id, owner_id, merchant_id, name, spec, price_cents, stock, is_default, status, created_at, updated_at)
  VALUES
    (p_pro||'_s2',  p_pro, v_owner_id, v_merchant_id, '2 席位', '2席/年', 134900*2,  9999, 1, 'active', v_now, v_now),
    (p_pro||'_s3',  p_pro, v_owner_id, v_merchant_id, '3 席位', '3席/年', 134900*3,  9999, 0, 'active', v_now, v_now),
    (p_pro||'_s4',  p_pro, v_owner_id, v_merchant_id, '4 席位', '4席/年', 134900*4,  9999, 0, 'active', v_now, v_now),
    (p_pro||'_s5',  p_pro, v_owner_id, v_merchant_id, '5 席位', '5席/年', 134900*5,  9999, 0, 'active', v_now, v_now),
    (p_pro||'_s6',  p_pro, v_owner_id, v_merchant_id, '6 席位', '6席/年', 134900*6,  9999, 0, 'active', v_now, v_now),
    (p_pro||'_s8',  p_pro, v_owner_id, v_merchant_id, '8 席位', '8席/年', 134900*8,  9999, 0, 'active', v_now, v_now),
    (p_pro||'_s10', p_pro, v_owner_id, v_merchant_id, '10 席位','10席/年',134900*10, 9999, 0, 'active', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

  -- ── 高级版 ──────────────────────────────────────────────
  INSERT INTO products (id, owner_id, merchant_id, title, subtitle, description,
    currency, price_cents, stock, status, created_at, updated_at)
  VALUES (p_premium, v_owner_id, v_merchant_id,
    '团队高级版', '专业团队套餐', '每席每月赠 16300 积分，年付享折扣',
    'CNY', 469900, 9999, 'active', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO product_entitlements (id, product_id, owner_id, entitlement_type, config_json, created_at, updated_at)
  VALUES (p_premium || '_ent', p_premium, v_owner_id, 'team_plan',
    '{"plan_tier":"premium","credits_per_seat_year":195600,"price_per_seat_cents":469900}',
    v_now, v_now)
  ON CONFLICT (owner_id, product_id) DO NOTHING;

  INSERT INTO product_skus (id, product_id, owner_id, merchant_id, name, spec, price_cents, stock, is_default, status, created_at, updated_at)
  VALUES
    (p_premium||'_s2',  p_premium, v_owner_id, v_merchant_id, '2 席位', '2席/年', 469900*2,  9999, 1, 'active', v_now, v_now),
    (p_premium||'_s3',  p_premium, v_owner_id, v_merchant_id, '3 席位', '3席/年', 469900*3,  9999, 0, 'active', v_now, v_now),
    (p_premium||'_s5',  p_premium, v_owner_id, v_merchant_id, '5 席位', '5席/年', 469900*5,  9999, 0, 'active', v_now, v_now),
    (p_premium||'_s10', p_premium, v_owner_id, v_merchant_id, '10 席位','10席/年',469900*10, 9999, 0, 'active', v_now, v_now),
    (p_premium||'_s20', p_premium, v_owner_id, v_merchant_id, '20 席位','20席/年',469900*20, 9999, 0, 'active', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

  -- ── 豪华版 ──────────────────────────────────────────────
  INSERT INTO products (id, owner_id, merchant_id, title, subtitle, description,
    currency, price_cents, stock, status, created_at, updated_at)
  VALUES (p_ultimate, v_owner_id, v_merchant_id,
    '团队豪华版', '旗舰团队套餐', '每席每月赠 32800 积分，年付享折扣',
    'CNY', 869900, 9999, 'active', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO product_entitlements (id, product_id, owner_id, entitlement_type, config_json, created_at, updated_at)
  VALUES (p_ultimate || '_ent', p_ultimate, v_owner_id, 'team_plan',
    '{"plan_tier":"ultimate","credits_per_seat_year":393600,"price_per_seat_cents":869900}',
    v_now, v_now)
  ON CONFLICT (owner_id, product_id) DO NOTHING;

  INSERT INTO product_skus (id, product_id, owner_id, merchant_id, name, spec, price_cents, stock, is_default, status, created_at, updated_at)
  VALUES
    (p_ultimate||'_s2',  p_ultimate, v_owner_id, v_merchant_id, '2 席位', '2席/年', 869900*2,  9999, 1, 'active', v_now, v_now),
    (p_ultimate||'_s5',  p_ultimate, v_owner_id, v_merchant_id, '5 席位', '5席/年', 869900*5,  9999, 0, 'active', v_now, v_now),
    (p_ultimate||'_s10', p_ultimate, v_owner_id, v_merchant_id, '10 席位','10席/年',869900*10, 9999, 0, 'active', v_now, v_now),
    (p_ultimate||'_s20', p_ultimate, v_owner_id, v_merchant_id, '20 席位','20席/年',869900*20, 9999, 0, 'active', v_now, v_now)
  ON CONFLICT (id) DO NOTHING;

END $$;
