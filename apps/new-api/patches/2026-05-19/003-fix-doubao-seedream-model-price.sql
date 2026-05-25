-- 003-fix-doubao-seedream-model-price.sql
-- Purpose: 修正 doubao-seedream-5-0 系列的 ModelPrice。
--
-- 002 patch 写入了 ModelPrice=5，但 new-api 的 ModelPrice 单位是 ¥/张
-- (quotaType=1 fixed-price)，不是积分数。
--   正确值：¥0.5/张（官方定价已确认）。
--   hono-api 换算：¥0.5 × 10 creditsPerCNY = 5 积分/张。
--
-- 用 options.value || EXCLUDED.value 保证新值覆盖旧值的相同 key。

BEGIN;

UPDATE options
SET value = (
    value::jsonb
    || '{"doubao-seedream-5-0":0.5,"doubao-seedream-5-0-lite":0.5,"doubao-seedream-5-0-260128":0.5,"doubao-seedream-5-0-lite-260128":0.5}'::jsonb
)::text
WHERE key = 'ModelPrice';

COMMIT;

-- 验证：
-- SELECT key, value::jsonb->'doubao-seedream-5-0' AS price
-- FROM options WHERE key = 'ModelPrice';
-- 期望: 0.5
