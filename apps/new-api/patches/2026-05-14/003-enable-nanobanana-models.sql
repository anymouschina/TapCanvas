-- =============================================================
-- Patch: 2026-05-14/003-enable-nanobanana-models
-- 启用 nanobanana 三件套，补全 abilities（default + auto），
-- 并对齐同族各渠道变体价格到族内最高值。
--
-- 模型映射（yunwu-gemini 渠道）：
--   nanobanana2      → gemini-3.1-flash-image-preview
--   nano-banana-fast → gemini-2.5-flash-image
--   nano-banana-pro  → gemini-3-pro-image-preview
--
-- 当前问题：
--   - models.status = 0（全部禁用）
--   - abilities.enabled = false，且缺 auto 组
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: 启用 models（主名称，yunwu 渠道；suchuang 渠道已停用，保持禁用）
-- -----------------------------------------------------------------------------

UPDATE models
SET status       = 1,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('nanobanana2', 'nano-banana-fast', 'nano-banana-pro')
  AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 2: 补全并启用 abilities（default + auto 两组）
-- -----------------------------------------------------------------------------

WITH target_models(model_name) AS (
  VALUES ('nanobanana2'), ('nano-banana-fast'), ('nano-banana-pro')
),
channel_row AS (
  SELECT id FROM channels
  WHERE name = 'yunwu-gemini' AND "group" = 'default'
  LIMIT 1
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  g.ability_group,
  m.model_name,
  c.id,
  true,
  0,
  0,
  'yunwu-gemini'
FROM target_models AS m
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
CROSS JOIN channel_row AS c
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = true,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- -----------------------------------------------------------------------------
-- Step 3: 价格对齐——各子族独立取 max，统一变体定价
--   nanobanana2*      max = 0.40
--   nano-banana-fast* max = 0.30
--   nano-banana-pro*  max = 0.70
-- （当前各族内部已一致，此步幂等兜底）
-- -----------------------------------------------------------------------------

WITH family_max AS (
  SELECT
    CASE
      WHEN key LIKE 'nanobanana2%'      THEN 'nanobanana2'
      WHEN key LIKE 'nano-banana-fast%' THEN 'nano-banana-fast'
      WHEN key LIKE 'nano-banana-pro%'  THEN 'nano-banana-pro'
    END AS family,
    key,
    value::numeric AS price
  FROM jsonb_each_text(
    (SELECT value::jsonb FROM options WHERE key = 'ModelPrice')
  )
  WHERE key LIKE 'nanobanana2%'
     OR key LIKE 'nano-banana-fast%'
     OR key LIKE 'nano-banana-pro%'
),
max_per_family AS (
  SELECT family, MAX(price) AS max_price
  FROM family_max
  GROUP BY family
),
aligned AS (
  SELECT fm.key, mpf.max_price
  FROM family_max fm
  JOIN max_per_family mpf ON mpf.family = fm.family
),
patch AS (
  SELECT jsonb_object_agg(key, max_price) AS patch_json FROM aligned
)
UPDATE options
SET value = (value::jsonb || (SELECT patch_json FROM patch))::text
WHERE key = 'ModelPrice';

-- -----------------------------------------------------------------------------
-- 验证
-- -----------------------------------------------------------------------------

\echo '----- nanobanana models -----'
SELECT model_name, kind, status FROM models
WHERE model_name IN ('nanobanana2', 'nano-banana-fast', 'nano-banana-pro')
  AND deleted_at IS NULL
ORDER BY model_name;

\echo '----- nanobanana abilities -----'
SELECT "group", model, enabled, tag FROM abilities
WHERE model IN ('nanobanana2', 'nano-banana-fast', 'nano-banana-pro')
ORDER BY model, "group";

\echo '----- nanobanana prices -----'
SELECT key, value::numeric AS price
FROM jsonb_each_text(
  (SELECT value::jsonb FROM options WHERE key = 'ModelPrice')
)
WHERE key LIKE 'nanobanana2%'
   OR key LIKE 'nano-banana-fast%'
   OR key LIKE 'nano-banana-pro%'
ORDER BY key;

COMMIT;
