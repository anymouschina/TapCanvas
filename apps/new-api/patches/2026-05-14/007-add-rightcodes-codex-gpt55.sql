-- =============================================================
-- Patch: 2026-05-14/007-add-rightcodes-codex-gpt55
-- 接入 right.codes Codex 端点，注册 gpt-5.5 模型。
--
-- 渠道信息：
--   - 接入点：https://www.right.codes/codex（OpenAI Responses API 兼容）
--   - 请求路径：/v1/responses
--   - 认证：Bearer sk-xxxxx
--
-- 定价（$2/M $12/M $0/M $0.2/M，缓存命中率 99.6%）：
--   ModelRatio["gpt-5.5"]       = 1.0   ($2/M input,  ratio = price/2)
--   CompletionRatio["gpt-5.5"]  = 6.0   ($12/M output, ratio = output/input)
--   CacheRatio["gpt-5.5"]       = 0.0   ($0/M cache read, free)
--   CreateCacheRatio["gpt-5.5"] = 0.1   ($0.2/M cache write, ratio = 0.2/2)
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: 注册模型 gpt-5.5（幂等）──────────────────────────────────────────

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'gpt-5.5',
  'gpt-5.5 via right.codes Codex gateway',
  NULL,
  NULL,
  v.id,
  NULL,
  'chat',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM (SELECT id FROM vendors WHERE name = 'RightCodes' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gpt-5.5' AND deleted_at IS NULL
);

UPDATE models
SET status       = 1,
    kind         = 'chat',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-5.5' AND deleted_at IS NULL AND status != 1;

-- ── Step 2: 注册渠道 rightcodes-codex（幂等）────────────────────────────────

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT
  'rightcodes-codex',
  1,
  'default',
  'gpt-5.5',
  '{}',
  1,
  'https://www.right.codes/codex',
  'PLACEHOLDER_RIGHTCODES_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  0, 0,
  'rightcodes',
  NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels
  WHERE name = 'rightcodes-codex' AND type = 1 AND "group" = 'default'
);

UPDATE channels
SET
  models   = 'gpt-5.5',
  base_url = 'https://www.right.codes/codex'
WHERE name = 'rightcodes-codex' AND type = 1 AND "group" = 'default';

-- ── Step 3: 注册 abilities（default + auto 路由组，幂等）────────────────────

WITH channel_row AS (
  SELECT id FROM channels
  WHERE name = 'rightcodes-codex' AND type = 1 AND "group" = 'default'
  LIMIT 1
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  g.ability_group,
  'gpt-5.5',
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

-- ── Step 4: 定价────────────────────────────────────────────────────────────

-- ModelRatio: $2/M input → ratio = 2/2 = 1.0
INSERT INTO options (key, value)
VALUES ('ModelRatio', '{"gpt-5.5": 1.0}')
ON CONFLICT (key) DO UPDATE
  SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

-- CompletionRatio: $12/M output / $2/M input = 6
INSERT INTO options (key, value)
VALUES ('CompletionRatio', '{"gpt-5.5": 6.0}')
ON CONFLICT (key) DO UPDATE
  SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

-- CacheRatio: $0/M cache read → 0 (free)
INSERT INTO options (key, value)
VALUES ('CacheRatio', '{"gpt-5.5": 0.0}')
ON CONFLICT (key) DO UPDATE
  SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

-- CreateCacheRatio: $0.2/M cache write / $2/M input = 0.1
INSERT INTO options (key, value)
VALUES ('CreateCacheRatio', '{"gpt-5.5": 0.1}')
ON CONFLICT (key) DO UPDATE
  SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

-- ── 验证──────────────────────────────────────────────────────────────────────

\echo '----- gpt-5.5 模型 -----'
SELECT id, model_name, kind, status FROM models
WHERE model_name = 'gpt-5.5' AND deleted_at IS NULL;

\echo '----- rightcodes-codex 渠道 -----'
SELECT id, name, type, base_url, models FROM channels
WHERE name = 'rightcodes-codex' AND type = 1 AND "group" = 'default';

\echo '----- gpt-5.5 abilities -----'
SELECT a.group, a.model, c.name AS channel, a.enabled, a.tag
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE a.model = 'gpt-5.5'
ORDER BY a.group, c.name;

\echo '----- gpt-5.5 定价 -----'
SELECT key, value::jsonb -> 'gpt-5.5' AS val
FROM options
WHERE key IN ('ModelRatio', 'CompletionRatio', 'CacheRatio', 'CreateCacheRatio')
ORDER BY key;

COMMIT;
