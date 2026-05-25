-- =============================================================
-- Patch: 2026-04-27/002-add-gpt-image-2-official
-- 新增 gpt-image-2-official — OpenAI 官方直连版，独立 SKU。
--
-- 与 gpt-image-2（apimart 代理）的区别：
--   - 独立 canonical key，不做 alias 映射
--   - 单独渠道（openai-official, type=1），model_mapping 指向 gpt-image-2
--   - 定价：base 4 积分 × 1.3 → 6 积分
--   - 4K 不在 UI 中提供单独分辨率控件（imageSize 即分辨率）
--
-- 执行顺序：[tapcanvas_new_api] new-api 库（PostgreSQL）
-- =============================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: 注册 gpt-image-2-official 模型记录
-- -----------------------------------------------------------------------------

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'gpt-image-2-official',
  'upstream gpt-image-2',
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
FROM (
  SELECT id FROM vendors WHERE name = 'OpenAI' AND deleted_at IS NULL LIMIT 1
) AS v
WHERE v.id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM models WHERE model_name = 'gpt-image-2-official' AND deleted_at IS NULL
  );

-- 若 OpenAI vendor 不存在则先创建（幂等）
INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT 'OpenAI', 'OpenAI official API', NULL, 1,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM vendors WHERE name = 'OpenAI' AND deleted_at IS NULL
);

-- 再次尝试插入模型（覆盖 vendor 不存在的情况）
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'gpt-image-2-official',
  'upstream gpt-image-2',
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
FROM (SELECT id FROM vendors WHERE name = 'OpenAI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gpt-image-2-official' AND deleted_at IS NULL
);

-- -----------------------------------------------------------------------------
-- Step 2: 注册 openai-official 渠道（若不存在）
-- model_mapping 将 gpt-image-2-official 翻译为 gpt-image-2（OpenAI 侧实际 model ID）
-- key 留 PLACEHOLDER，操作员在 Admin UI 填入真实 API Key。
-- -----------------------------------------------------------------------------

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
VALUES (
  'openai-official',
  1,                     -- ChannelType OpenAI
  'default',
  'gpt-image-2-official',
  '{"gpt-image-2-official": "gpt-image-2"}',
  1,
  'https://api.openai.com',
  'PLACEHOLDER_OPENAI_OFFICIAL_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  0, 0,
  'openai-official',
  NULL, NULL, NULL
)
ON CONFLICT DO NOTHING;

-- 同步 models 列表（幂等，已存在则追加）
UPDATE channels
SET models        = 'gpt-image-2-official',
    model_mapping = '{"gpt-image-2-official": "gpt-image-2"}',
    base_url      = 'https://api.openai.com'
WHERE name = 'openai-official' AND type = 1 AND "group" = 'default';

-- -----------------------------------------------------------------------------
-- Step 3: 注册 abilities（default + auto 路由组）
-- -----------------------------------------------------------------------------

WITH channel_row AS (
  SELECT id FROM channels
  WHERE name = 'openai-official' AND type = 1 AND "group" = 'default'
  LIMIT 1
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group, 'gpt-image-2-official', c.id, true, 0, 0, 'openai-official'
FROM channel_row AS c
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- -----------------------------------------------------------------------------
-- Step 4: 设置 ModelPrice
-- gpt-image-2 base = 4 积分，+30% → 6 积分
-- 4K spec 由 hono-api model_credit_cost_specs 控制（11 积分），此处仅设 base。
-- 合并策略：已有值优先（admin 覆盖不被覆盖）。
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  '{"gpt-image-2-official": 6}'
)
ON CONFLICT (key) DO UPDATE
  SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;

-- 验证：
-- SELECT model_name, kind, status FROM models WHERE model_name = 'gpt-image-2-official';
-- SELECT name, type, models, model_mapping FROM channels WHERE name = 'openai-official';
-- SELECT value::jsonb -> 'gpt-image-2-official' AS price FROM options WHERE key = 'ModelPrice';
