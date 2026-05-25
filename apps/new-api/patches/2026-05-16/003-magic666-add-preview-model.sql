-- 003-magic666-add-preview-model.sql
-- Purpose: 补充 002 遗漏的 gemini-2.5-flash-image-preview 模型。
--
-- 说明：外部调用者统一走 POST /v1/images/generations，
-- new-api magic666 适配器内部根据模型名前缀决定是否转成
-- Gemini 格式（/v1beta/models/{model}:generateContent）发往 magic666.top，
-- 调用方无需关心下游格式。
--
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: 补充 gemini-2.5-flash-image-preview 模型（real id + -magic666 alias）
-- ---------------------------------------------------------------------------

WITH base_models(base_name, kind) AS (VALUES
  ('gemini-2.5-flash-image-preview', 'image')
),
all_forms AS (
  SELECT base_name AS model_name, kind,
         'Magic666 upstream ' || base_name AS description
  FROM base_models
  UNION ALL
  SELECT base_name || '-magic666' AS model_name, kind,
         'Magic666 vendor-suffixed alias for ' || base_name AS description
  FROM base_models
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT f.model_name, f.description, NULL, NULL, v.id, NULL, f.kind, 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM all_forms AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = 'Magic666' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = f.model_name AND deleted_at IS NULL
);

-- 确保 -magic666 alias 归属 Magic666 vendor
UPDATE models AS target
SET kind         = 'image',
    vendor_id    = v.id,
    status       = 1,
    deleted_at   = NULL,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM (SELECT id FROM vendors WHERE name = 'Magic666' AND deleted_at IS NULL LIMIT 1) AS v
WHERE target.model_name = 'gemini-2.5-flash-image-preview-magic666';

-- ---------------------------------------------------------------------------
-- Step 2: 同步 channel models 字段（追加两个新模型名）
-- ---------------------------------------------------------------------------

UPDATE channels
SET models = models
  || ',gemini-2.5-flash-image-preview'
  || ',gemini-2.5-flash-image-preview-magic666',
    model_mapping = (model_mapping::jsonb || $json${
      "gemini-2.5-flash-image-preview-magic666": "gemini-2.5-flash-image-preview"
    }$json$::jsonb)::text
WHERE name = 'magic666' AND type = 62 AND "group" = 'default'
  AND models NOT LIKE '%gemini-2.5-flash-image-preview,%';

-- ---------------------------------------------------------------------------
-- Step 3: 补充 abilities
-- ---------------------------------------------------------------------------

WITH new_models(model) AS (VALUES
  ('gemini-2.5-flash-image-preview'),
  ('gemini-2.5-flash-image-preview-magic666')
),
ability_matrix AS (
  SELECT g.ability_group, m.model
  FROM new_models AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, c.id, true, 0, 0, 'magic666'
FROM ability_matrix AS am
JOIN channels AS c ON c.name = 'magic666' AND c.type = 62 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    tag     = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 4: 补充 ModelPrice
-- ---------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${
    "gemini-2.5-flash-image-preview":        3,
    "gemini-2.5-flash-image-preview-magic666": 3
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
