-- 修正团队套餐定价：10 积分 = ¥1
-- plan_standard: 100积分/席/月, ¥10/月/席, ¥118/年/席
UPDATE team_subscription_plans SET
  credits_per_seat_per_month = 100,
  price_monthly_cents        = 1000,
  price_annual_cents         = 11800,
  updated_at                 = NOW()
WHERE id = 'plan_standard';

-- plan_advanced: 500积分/席/月, ¥48.4/月/席, ¥570/年/席
UPDATE team_subscription_plans SET
  credits_per_seat_per_month = 500,
  price_monthly_cents        = 4840,
  price_annual_cents         = 57000,
  updated_at                 = NOW()
WHERE id = 'plan_advanced';

-- plan_pro: 2000积分/席/月, ¥187.4/月/席, ¥2206/年/席
UPDATE team_subscription_plans SET
  credits_per_seat_per_month = 2000,
  price_monthly_cents        = 18740,
  price_annual_cents         = 220600,
  updated_at                 = NOW()
WHERE id = 'plan_pro';

-- plan_premium: 5500积分/席/月, ¥500/月/席, ¥5882/年/席
UPDATE team_subscription_plans SET
  credits_per_seat_per_month = 5500,
  price_monthly_cents        = 50000,
  price_annual_cents         = 588200,
  updated_at                 = NOW()
WHERE id = 'plan_premium';
