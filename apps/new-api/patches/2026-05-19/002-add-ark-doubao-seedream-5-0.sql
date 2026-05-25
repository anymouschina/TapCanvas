-- 002-add-ark-doubao-seedream-5-0.sql
-- Purpose: register doubao-seedream-5-0 (Doubao Seedream 5.0 Lite) on the ARK direct channel.
--
-- API:  POST https://ark.cn-beijing.volces.com/api/v3/images/generations  (synchronous)
-- Channel type: 45 (VolcEngine)
--
-- Models registered:
--   doubao-seedream-5-0          (canonical, client-facing)
--   doubao-seedream-5-0-lite     (canonical, lite variant)
--   doubao-seedream-5-0-260128   (ARK upstream ID)
--   doubao-seedream-5-0-lite-260128 (ARK upstream ID, lite)
--
-- API key: copied from existing ark-doubao-video channel (same ARK credentials).
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Ensure vendor exists (ByteDance / 火山方舟 ARK).
-- ---------------------------------------------------------------------------

INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
VALUES (
  'ByteDance ARK',
  '字节跳动火山方舟（ARK）直连渠道 — 豆包系列图片/视频生成模型',
  NULL, 1,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
)
ON CONFLICT DO NOTHING;

UPDATE vendors
SET description  = '字节跳动火山方舟（ARK）直连渠道 — 豆包系列图片/视频生成模型',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'ByteDance ARK' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Seed models.
-- ---------------------------------------------------------------------------

WITH vendor_id AS (
  SELECT id FROM vendors WHERE name = 'ByteDance ARK' AND deleted_at IS NULL LIMIT 1
),
model_rows(model_name, description) AS (VALUES
  ('doubao-seedream-5-0',          'Doubao Seedream 5.0 Lite — ARK canonical name (client-facing)'),
  ('doubao-seedream-5-0-lite',     'Doubao Seedream 5.0 Lite variant — ARK canonical name (client-facing)'),
  ('doubao-seedream-5-0-260128',      'Doubao Seedream 5.0 Lite — ARK upstream model ID'),
  ('doubao-seedream-5-0-lite-260128', 'Doubao Seedream 5.0 Lite — ARK upstream model ID (lite suffix)')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  r.model_name, r.description, NULL, NULL, v.id, NULL, 'image', 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM model_rows r
CROSS JOIN vendor_id v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = r.model_name AND deleted_at IS NULL
);

UPDATE models AS m
SET kind         = 'image',
    status       = 1,
    deleted_at   = NULL,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE m.model_name IN (
  'doubao-seedream-5-0',
  'doubao-seedream-5-0-lite',
  'doubao-seedream-5-0-260128',
  'doubao-seedream-5-0-lite-260128'
);

-- ---------------------------------------------------------------------------
-- Step 3: Upsert channel (type 45 = VolcEngine, direct ARK image API).
-- API key is copied from the existing ark-doubao-video channel.
-- ---------------------------------------------------------------------------

WITH existing_key AS (
  SELECT key FROM channels WHERE name = 'ark-doubao-video' AND type = 54 LIMIT 1
),
channel_seed AS (
  SELECT
    'ark-doubao-image'::text                                    AS name,
    45                                                          AS type,
    'default'::text                                             AS channel_group,
    'doubao-seedream-5-0,doubao-seedream-5-0-lite,doubao-seedream-5-0-260128,doubao-seedream-5-0-lite-260128'::text AS models,
    '{"doubao-seedream-5-0":"doubao-seedream-5-0-260128","doubao-seedream-5-0-lite":"doubao-seedream-5-0-lite-260128"}'::text AS model_mapping,
    1                                                           AS status,
    'https://ark.cn-beijing.volces.com'::text                   AS base_url,
    ek.key                                                      AS api_key,
    '{"watermark":false}'::text                                 AS param_override,
    10                                                          AS priority,
    100                                                         AS weight,
    'ark-doubao-image'::text                                    AS tag
  FROM existing_key ek
)
INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  param_override, created_time, test_time, priority, weight, tag,
  setting, header_override
)
SELECT
  cs.name, cs.type, cs.channel_group, cs.models, cs.model_mapping, cs.status,
  cs.base_url, cs.api_key, cs.param_override,
  EXTRACT(EPOCH FROM NOW())::bigint, 0,
  cs.priority, cs.weight, cs.tag,
  NULL, NULL
FROM channel_seed cs
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'ark-doubao-image' AND type = 45 AND "group" = 'default'
);

-- Sync models/model_mapping on re-runs; leave key/status/priority untouched.
UPDATE channels
SET models        = 'doubao-seedream-5-0,doubao-seedream-5-0-lite,doubao-seedream-5-0-260128,doubao-seedream-5-0-lite-260128',
    model_mapping = '{"doubao-seedream-5-0":"doubao-seedream-5-0-260128","doubao-seedream-5-0-lite":"doubao-seedream-5-0-lite-260128"}',
    param_override = '{"watermark":false}',
    base_url      = 'https://ark.cn-beijing.volces.com'
WHERE name = 'ark-doubao-image' AND type = 45 AND "group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 4: Seed abilities.
-- ---------------------------------------------------------------------------

WITH all_models(model) AS (VALUES
  ('doubao-seedream-5-0'),
  ('doubao-seedream-5-0-lite'),
  ('doubao-seedream-5-0-260128'),
  ('doubao-seedream-5-0-lite-260128')
),
ability_matrix AS (
  SELECT g.ability_group, m.model
  FROM all_models m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, c.id, true, 10, 100, 'ark-doubao-image'
FROM ability_matrix am
JOIN channels c
  ON c.name = 'ark-doubao-image' AND c.type = 45 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 5: Model pricing.
-- Doubao Seedream 5.0 官方定价（2026-05）：¥0.5/张（2K）
-- 按 1 credit ≈ ¥0.1 换算 → 5 credits/image
-- ---------------------------------------------------------------------------

-- ModelPrice 单位是 ¥/张（quotaType=1 fixed price）。
-- 官方定价 ¥0.5/张（2K），故填 0.5。
-- 使用 options.value || EXCLUDED.value 让新值覆盖旧值中相同 key。
INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${"doubao-seedream-5-0": 0.5, "doubao-seedream-5-0-lite": 0.5, "doubao-seedream-5-0-260128": 0.5, "doubao-seedream-5-0-lite-260128": 0.5}$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
