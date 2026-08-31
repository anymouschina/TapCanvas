-- API key 计费归属：为 tc_sk key 指定「扣谁的积分」。
-- 可空；空表示回落 key 拥有者解析出的团队（维持现状）。
-- 幂等：IF NOT EXISTS 兼容 dev/prod 重复执行与 baseline 场景。
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "billing_team_id" TEXT;
