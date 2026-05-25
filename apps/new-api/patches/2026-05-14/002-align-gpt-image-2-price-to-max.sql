-- =============================================================
-- Patch: 2026-05-14/002-align-gpt-image-2-price-to-max
-- 将所有 gpt-image-2* 变体的 ModelPrice 统一为该族最高价。
--
-- 背景：同一底层模型（gpt-image-2）通过不同渠道（apimart、rightcodes、
--   yunwu/all、suchuang 等）对外暴露为不同 SKU 名称。各渠道采购成本
--   不同，但对外定价应统一取最高值，避免用户通过选择便宜 SKU 绕价。
--
-- 当前状态（执行前）：
--   gpt-image-2            = 0.64
--   gpt-image-2-apimart    = 0.64
--   gpt-image-2-rightcodes = 0.64
--   gpt-image-2-official   = 0.64
--   gpt-image-2-all        = 0.40  ← 偏低，需对齐
--   gpt-image-2-suchuang   = 0.40  ← 偏低，需对齐
--
-- 算法：动态找 gpt-image-2* 族 max → 全部覆写为 max。
--   无硬编码目标价，未来有新 SKU 加入也自动生效。
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

-- Step 1: 打印当前状态
\echo '----- 对齐前 gpt-image-2* 定价 -----'
SELECT
  key,
  value::numeric AS price
FROM jsonb_each_text(
  (SELECT value::jsonb FROM options WHERE key = 'ModelPrice')
)
WHERE key LIKE 'gpt-image-2%'
ORDER BY key;

-- Step 2: 找最高价，将所有 gpt-image-2* 统一到 max
WITH current_prices AS (
  SELECT key, value::numeric AS price
  FROM jsonb_each_text(
    (SELECT value::jsonb FROM options WHERE key = 'ModelPrice')
  )
  WHERE key LIKE 'gpt-image-2%'
),
max_price AS (
  SELECT MAX(price) AS max_val FROM current_prices
),
aligned_patch AS (
  SELECT jsonb_object_agg(cp.key, mp.max_val) AS patch
  FROM current_prices AS cp
  CROSS JOIN max_price AS mp
)
UPDATE options
SET value = (value::jsonb || (SELECT patch FROM aligned_patch))::text
WHERE key = 'ModelPrice';

-- Step 3: 验证
\echo '----- 对齐后 gpt-image-2* 定价 -----'
SELECT
  key,
  value::numeric AS price
FROM jsonb_each_text(
  (SELECT value::jsonb FROM options WHERE key = 'ModelPrice')
)
WHERE key LIKE 'gpt-image-2%'
ORDER BY key;

COMMIT;
