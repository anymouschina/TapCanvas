-- =============================================================
-- Patch: 2026-05-14/001-add-rightcodes-image-channel
-- 新增 RightCodes 图像生成渠道。
--
-- 渠道信息：
--   - 文档：https://docs.right.codes/docs/rc_extension/draw/images-generations.html
--   - 接入点：https://www.right.codes/draw（OpenAI 兼容）
--   - 认证：Bearer sk-xxxxx
--   - 当前已确认模型：gpt-image-2
--
-- 命名规范：gpt-image-2-rightcodes 映射上游 gpt-image-2
-- 定价：与 gpt-image-2-apimart 对齐（0.64 积分/张），可按实际成本调整
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: 注册 RightCodes vendor（幂等）
-- -----------------------------------------------------------------------------

INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT
  'RightCodes',
  'right.codes — OpenAI-compatible image generation gateway',
  NULL,
  1,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM vendors WHERE name = 'RightCodes' AND deleted_at IS NULL
);

UPDATE vendors
SET
  description  = 'right.codes — OpenAI-compatible image generation gateway',
  status       = 1,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'RightCodes' AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 2: 注册模型 gpt-image-2-rightcodes（幂等）
-- -----------------------------------------------------------------------------

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'gpt-image-2-rightcodes',
  'gpt-image-2 via right.codes gateway',
  NULL,
  NULL,
  v.id,
  NULL,
  'image',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM (SELECT id FROM vendors WHERE name = 'RightCodes' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gpt-image-2-rightcodes' AND deleted_at IS NULL
);

UPDATE models
SET
  kind         = 'image',
  status       = 1,
  deleted_at   = NULL,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-image-2-rightcodes' AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 3: 注册渠道 rightcodes-draw（幂等）
-- key 填 PLACEHOLDER，操作员在 Admin UI 替换真实 sk-xxx
-- model_mapping: 将内部名 gpt-image-2-rightcodes 翻译为上游的 gpt-image-2
-- -----------------------------------------------------------------------------

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT
  'rightcodes-draw',
  1,
  'default',
  'gpt-image-2-rightcodes',
  '{"gpt-image-2-rightcodes": "gpt-image-2"}',
  1,
  'https://www.right.codes/draw',
  'PLACEHOLDER_RIGHTCODES_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  0, 0,
  'rightcodes',
  NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels
  WHERE name = 'rightcodes-draw' AND type = 1 AND "group" = 'default'
);

UPDATE channels
SET
  models        = 'gpt-image-2-rightcodes',
  model_mapping = '{"gpt-image-2-rightcodes": "gpt-image-2"}',
  base_url      = 'https://www.right.codes/draw'
WHERE name = 'rightcodes-draw' AND type = 1 AND "group" = 'default';

-- -----------------------------------------------------------------------------
-- Step 4: 注册 abilities（default + auto 路由组，幂等）
-- -----------------------------------------------------------------------------

WITH channel_row AS (
  SELECT id FROM channels
  WHERE name = 'rightcodes-draw' AND type = 1 AND "group" = 'default'
  LIMIT 1
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  g.ability_group,
  'gpt-image-2-rightcodes',
  c.id,
  true,
  0,
  0,
  'rightcodes'
FROM channel_row AS c
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- -----------------------------------------------------------------------------
-- Step 5: 定价（ModelPrice）
-- 与 gpt-image-2-apimart 对齐，0.64 积分/张
-- 合并策略：已有 key 优先（admin 手动调整不被覆盖）
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"gpt-image-2-rightcodes": 0.64}'
)
ON CONFLICT (key) DO UPDATE
  SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

-- -----------------------------------------------------------------------------
-- 验证
-- -----------------------------------------------------------------------------

\echo
\echo '----- RightCodes gpt-image-2-rightcodes -----'
SELECT id, model_name, kind, status FROM models
WHERE model_name = 'gpt-image-2-rightcodes' AND deleted_at IS NULL;

SELECT id, name, type, base_url, models, model_mapping FROM channels
WHERE name = 'rightcodes-draw' AND type = 1 AND "group" = 'default';

SELECT "group", model, enabled, tag FROM abilities
WHERE model = 'gpt-image-2-rightcodes' ORDER BY "group";

SELECT value::jsonb -> 'gpt-image-2-rightcodes' AS price FROM options WHERE key = 'ModelPrice';

COMMIT;
