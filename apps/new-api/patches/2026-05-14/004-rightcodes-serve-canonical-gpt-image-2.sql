-- =============================================================
-- Patch: 2026-05-14/004-rightcodes-serve-canonical-gpt-image-2
-- 让 rightcodes-draw 渠道直接承接 gpt-image-2 流量，
-- 将内部别名 gpt-image-2-rightcodes 从公开目录隐藏。
--
-- 背景：001 patch 创建了 gpt-image-2-rightcodes 作为渠道别名，
--   但用户不应看到带后缀的内部路由名。apimart 渠道同理——
--   只有 -official 后缀对外保留。rightcodes 作为 gpt-image-2
--   的另一个承载渠道，应透明接入，不新增用户可见的 SKU。
--
-- 变更：
--   1. rightcodes-draw 渠道 models 列改为 gpt-image-2，
--      model_mapping 仅保留 gpt-image-2-rightcodes 兼容映射
--   2. 为 gpt-image-2 在 rightcodes-draw 渠道添加 abilities
--   3. gpt-image-2-rightcodes model 状态改为 0（对外隐藏）
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: 更新 rightcodes-draw 渠道，把 gpt-image-2 加入 models 列
-- 保留 gpt-image-2-rightcodes 映射作为兼容，新增 gpt-image-2 直通
-- -----------------------------------------------------------------------------

UPDATE channels
SET
  models        = 'gpt-image-2',
  model_mapping = '{"gpt-image-2-rightcodes": "gpt-image-2"}'
WHERE name = 'rightcodes-draw' AND type = 1 AND "group" = 'default';

-- -----------------------------------------------------------------------------
-- Step 2: 为 gpt-image-2 添加 rightcodes-draw 渠道的 abilities
-- -----------------------------------------------------------------------------

WITH channel_row AS (
  SELECT id FROM channels
  WHERE name = 'rightcodes-draw' AND type = 1 AND "group" = 'default'
  LIMIT 1
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  g.ability_group,
  'gpt-image-2',
  c.id,
  true,
  0,
  0,
  'rightcodes'
FROM channel_row AS c
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = true,
      tag      = EXCLUDED.tag;

-- -----------------------------------------------------------------------------
-- Step 3: 隐藏 gpt-image-2-rightcodes（status=0）
-- 旧 ability 保留但设 enabled=false（避免路由到该别名）
-- -----------------------------------------------------------------------------

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-image-2-rightcodes' AND deleted_at IS NULL;

UPDATE abilities
SET enabled = false
WHERE model = 'gpt-image-2-rightcodes';

-- -----------------------------------------------------------------------------
-- 验证
-- -----------------------------------------------------------------------------

\echo '----- rightcodes-draw 渠道 -----'
SELECT id, name, models, model_mapping FROM channels
WHERE name = 'rightcodes-draw' AND type = 1 AND "group" = 'default';

\echo '----- gpt-image-2 abilities（含 rightcodes）-----'
SELECT a.group, a.model, c.name AS channel, a.enabled, a.tag
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE a.model = 'gpt-image-2'
ORDER BY a.group, c.name;

\echo '----- gpt-image-2-rightcodes 可见性 -----'
SELECT model_name, status FROM models
WHERE model_name = 'gpt-image-2-rightcodes' AND deleted_at IS NULL;

COMMIT;
