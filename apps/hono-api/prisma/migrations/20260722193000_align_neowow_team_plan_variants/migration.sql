-- NeoWow enterprise levels observed on 2026-07-22 expose three PLUS variants,
-- three PRO variants, two MAX variants and one ULTRA variant. Each row remains
-- independently purchasable while the web groups rows with the same tier.
-- Monthly list prices are the exact annual original prices divided by twelve;
-- monthly included credits follow the confirmed CNY 1 = 100 credits ratio.
UPDATE "team_subscription_plans"
SET
  "enabled" = 0,
  "updated_at" = NOW()::text
WHERE "id" IN ('plan_standard', 'plan_advanced', 'plan_pro', 'plan_premium');

WITH variant_data (
  id,
  name,
  tier,
  variant_order,
  price_monthly_cents,
  price_annual_cents,
  monthly_credits_per_seat,
  annual_credits_per_seat,
  annual_bonus_per_seat,
  seats,
  concurrent_tasks_per_seat,
  unlimited_concurrent_tasks,
  compare_at_annual_cents,
  sort_weight
) AS (
  VALUES
    ('neo_team_plus',   'PLUS',  'PLUS',  1,  9580,  87000,  9580,  95800,  19160,  5,  8, FALSE, 114960, 10),
    ('neo_team_plus_t2','PLUS',  'PLUS',  2, 16180, 145000, 16180, 161800,  32360,  5,  8, FALSE, 194160, 11),
    ('neo_team_plus_t3','PLUS',  'PLUS',  3, 22380, 198000, 22380, 223800,  44760,  5,  8, FALSE, 268560, 12),
    ('neo_team_pro',    'PRO',   'PRO',   1, 15290, 133800, 15290, 152900,  30580, 10, 12, FALSE, 183480, 20),
    ('neo_team_pro_t2', 'PRO',   'PRO',   2, 25790, 223000, 25790, 257900,  51580, 10, 12, FALSE, 309480, 21),
    ('neo_team_pro_t3', 'PRO',   'PRO',   3, 51990, 446000, 51990, 519900, 103980, 10, 12, FALSE, 623880, 22),
    ('neo_team_max',    'MAX',   'MAX',   1, 34450, 290000, 34450, 344500,  68900, 20, 20, FALSE, 413400, 30),
    ('neo_team_max_t2', 'MAX',   'MAX',   2, 69495, 580000, 69495, 694950, 138990, 20, 20, FALSE, 833940, 31),
    ('neo_team_ultra',  'ULTRA', 'ULTRA', 1, 36132, 300000, 36132, 361320,  72264, 50,  0, TRUE,  433584, 40)
)
INSERT INTO "team_subscription_plans" (
  "id",
  "name",
  "tier",
  "price_monthly_cents",
  "price_annual_cents",
  "credits_per_seat_per_month",
  "max_seats",
  "min_seats",
  "features_json",
  "sort_weight",
  "enabled",
  "created_at",
  "updated_at"
)
SELECT
  id,
  name,
  tier,
  price_monthly_cents,
  price_annual_cents,
  monthly_credits_per_seat,
  seats,
  seats,
  jsonb_build_object(
    'concurrent_tasks_per_seat', concurrent_tasks_per_seat,
    'unlimited_concurrent_tasks', unlimited_concurrent_tasks,
    'canvas_collab', TRUE,
    'shared_asset_library', TRUE,
    'seat_management', TRUE,
    'credit_quota_control', TRUE,
    'fast_invoice', TRUE,
    'creditGrants', jsonb_build_object(
      'monthly', jsonb_build_object(
        'includedCreditsPerSeat', monthly_credits_per_seat,
        'firstPurchaseBonusCreditsPerSeat', 0
      ),
      'annual', jsonb_build_object(
        'includedCreditsPerSeat', annual_credits_per_seat,
        'firstPurchaseBonusCreditsPerSeat', annual_bonus_per_seat
      )
    ),
    'presentation', jsonb_build_object(
      'badge', seats || ' 席团队',
      'variantOrder', variant_order,
      'compareAtMonthlyCents', 0,
      'compareAtAnnualCents', compare_at_annual_cents,
      'accent', CASE tier
        WHEN 'PRO' THEN 'violet'
        WHEN 'MAX' THEN 'blue'
        WHEN 'ULTRA' THEN 'cyan'
        ELSE 'graphite'
      END,
      'featured', tier = 'PRO',
      'campaignBenefits', jsonb_build_array(
        '首次开通赠送额外积分',
        '企业消费升级享受充值优惠权益'
      ),
      'capabilities', jsonb_build_array(
        '多人画布协作',
        CASE WHEN unlimited_concurrent_tasks
          THEN '无限并发任务'
          ELSE concurrent_tasks_per_seat || ' 个并发任务/席位'
        END,
        '团队席位管理',
        '积分用量管控',
        '项目权限管理',
        '极速开发票',
        '团队资产隔离',
        '包含个人版所有功能'
      )
    )
  )::text,
  sort_weight,
  1,
  NOW()::text,
  NOW()::text
FROM variant_data
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "tier" = EXCLUDED."tier",
  "price_monthly_cents" = EXCLUDED."price_monthly_cents",
  "price_annual_cents" = EXCLUDED."price_annual_cents",
  "credits_per_seat_per_month" = EXCLUDED."credits_per_seat_per_month",
  "max_seats" = EXCLUDED."max_seats",
  "min_seats" = EXCLUDED."min_seats",
  "features_json" = EXCLUDED."features_json",
  "sort_weight" = EXCLUDED."sort_weight",
  "enabled" = EXCLUDED."enabled",
  "updated_at" = EXCLUDED."updated_at";
