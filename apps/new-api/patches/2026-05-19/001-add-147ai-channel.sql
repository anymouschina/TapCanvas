-- 001-add-147ai-channel.sql
-- Purpose: register the 147AI vendor and channel (ChannelType 63).
--
-- 147AI (api.147ai.cn) exposes:
--   - Gemini image models via Gemini-native format (Bearer auth)
--   - gpt-image-2 via OpenAI image format (Bearer auth)
--
-- Models seeded (real id + vendor-suffixed alias):
--   gemini-3-pro-image-preview     (image, Gemini format)
--   gemini-3.1-flash-image-preview (image, Gemini format)
--   gpt-image-2                    (image, OpenAI format)
--
-- Key: PLACEHOLDER_147AI_KEY — fill in via admin console after apply.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Seed vendor.
-- ---------------------------------------------------------------------------

WITH vendor_seed(name, description, status) AS (
  VALUES ('147AI', '147ai.cn — AI image proxy supporting GPT and Gemini image models', 1)
)
INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT s.name, s.description, NULL, s.status,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM vendors WHERE name = s.name AND deleted_at IS NULL
);

UPDATE vendors
SET description  = '147ai.cn — AI image proxy supporting GPT and Gemini image models',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = '147AI' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Seed models (real id already exist from magic666; add -147ai aliases).
-- ---------------------------------------------------------------------------

WITH base_models(base_name, kind) AS (VALUES
  ('gemini-3-pro-image-preview',      'image'),
  ('gemini-3.1-flash-image-preview',  'image'),
  ('gpt-image-2',                     'image')
),
alias_forms AS (
  SELECT base_name || '-147ai' AS model_name, kind,
         '147AI vendor-suffixed alias for ' || base_name AS description
  FROM base_models
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT f.model_name, f.description, NULL, NULL, v.id, NULL, f.kind, 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM alias_forms AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = '147AI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = f.model_name AND deleted_at IS NULL
);

-- Update -147ai aliases to point to this vendor.
WITH base_models(base_name, kind) AS (VALUES
  ('gemini-3-pro-image-preview',     'image'),
  ('gemini-3.1-flash-image-preview', 'image'),
  ('gpt-image-2',                    'image')
)
UPDATE models AS target
SET kind         = f.kind,
    vendor_id    = v.id,
    status       = 1,
    deleted_at   = NULL,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM (SELECT base_name || '-147ai' AS model_name, kind FROM base_models) AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = '147AI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE target.model_name = f.model_name;

-- ---------------------------------------------------------------------------
-- Step 3: Upsert channel (type 63 = ChannelType147AI).
-- ---------------------------------------------------------------------------

WITH channel_seed(name, type, channel_group, models, model_mapping, status, base_url, key, priority, weight, tag) AS (
  VALUES (
    '147ai',
    63,
    'default',
    'gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gpt-image-2,gemini-3-pro-image-preview-147ai,gemini-3.1-flash-image-preview-147ai,gpt-image-2-147ai',
    $json${
      "gemini-3-pro-image-preview-147ai":     "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview-147ai": "gemini-3.1-flash-image-preview",
      "gpt-image-2-147ai":                    "gpt-image-2"
    }$json$,
    1,
    'https://api.147ai.cn',
    'PLACEHOLDER_147AI_KEY',
    10, 100, '147ai'
  )
)
INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT s.name, s.type, s.channel_group, s.models, s.model_mapping, s.status, s.base_url, s.key,
       EXTRACT(EPOCH FROM NOW())::bigint, 0, s.priority, s.weight, s.tag,
       NULL, NULL, NULL
FROM channel_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = s.name AND type = s.type AND "group" = s.channel_group
);

-- Sync models/model_mapping/base_url on re-runs; leave key/status/priority untouched.
UPDATE channels AS target
SET models        = 'gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gpt-image-2,gemini-3-pro-image-preview-147ai,gemini-3.1-flash-image-preview-147ai,gpt-image-2-147ai',
    model_mapping = $json${
      "gemini-3-pro-image-preview-147ai":     "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview-147ai": "gemini-3.1-flash-image-preview",
      "gpt-image-2-147ai":                    "gpt-image-2"
    }$json$,
    base_url      = 'https://api.147ai.cn'
WHERE name = '147ai' AND type = 63 AND "group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 4: Seed abilities.
-- ---------------------------------------------------------------------------

WITH base_models(base_name) AS (VALUES
  ('gemini-3-pro-image-preview'),
  ('gemini-3.1-flash-image-preview'),
  ('gpt-image-2')
),
all_model_names AS (
  SELECT base_name AS model FROM base_models
  UNION ALL
  SELECT base_name || '-147ai' FROM base_models
),
ability_matrix AS (
  SELECT g.ability_group, m.model
  FROM all_model_names AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, c.id, true, 10, 100, '147ai'
FROM ability_matrix AS am
JOIN channels AS c
  ON c.name = '147ai' AND c.type = 63 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 5: Seed ModelPrice (flat per-task USD, reuse magic666 pricing).
-- ---------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${
    "gemini-3-pro-image-preview-147ai":    10,
    "gemini-3.1-flash-image-preview-147ai": 3,
    "gpt-image-2-147ai":                    5
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
