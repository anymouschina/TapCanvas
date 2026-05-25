-- 002-add-magic666-channel.sql
-- Purpose: register the magic666.top vendor and channel (ChannelType 62).
--
-- magic666.top is a proxy that exposes:
--   - Gemini image models via Gemini-native format (Bearer auth)
--   - gpt-image-2 / gpt-image-2-pro via OpenAI image format (Bearer auth)
--
-- Models seeded (real id + vendor-suffixed alias):
--   gpt-image-2            (image, OpenAI format)
--   gpt-image-2-pro        (image, OpenAI format)  -- magic666-specific model
--   gemini-2.5-flash-image (image, Gemini format)
--   gemini-3-pro-image-preview     (image, Gemini format)
--   gemini-3.1-flash-image-preview (image, Gemini format)
--
-- Key: PLACEHOLDER_MAGIC666_KEY — fill in via admin console after apply.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Seed vendor.
-- ---------------------------------------------------------------------------

WITH vendor_seed(name, description, status) AS (
  VALUES ('Magic666', 'magic666.top — AI image proxy supporting GPT and Gemini image models', 1)
)
INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT s.name, s.description, NULL, s.status,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM vendors WHERE name = s.name AND deleted_at IS NULL
);

UPDATE vendors
SET description  = 'magic666.top — AI image proxy supporting GPT and Gemini image models',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'Magic666' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Seed models (real id + -magic666 alias).
-- ---------------------------------------------------------------------------

WITH base_models(base_name, kind) AS (VALUES
  ('gpt-image-2',                     'image'),
  ('gpt-image-2-pro',                 'image'),
  ('gemini-2.5-flash-image',          'image'),
  ('gemini-3-pro-image-preview',      'image'),
  ('gemini-3.1-flash-image-preview',  'image')
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

-- Update -magic666 aliases to point to this vendor.
WITH base_models(base_name, kind) AS (VALUES
  ('gpt-image-2',                    'image'),
  ('gpt-image-2-pro',                'image'),
  ('gemini-2.5-flash-image',         'image'),
  ('gemini-3-pro-image-preview',     'image'),
  ('gemini-3.1-flash-image-preview', 'image')
)
UPDATE models AS target
SET kind         = f.kind,
    vendor_id    = v.id,
    status       = 1,
    deleted_at   = NULL,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM (SELECT base_name || '-magic666' AS model_name, kind FROM base_models) AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = 'Magic666' AND deleted_at IS NULL LIMIT 1) AS v
WHERE target.model_name = f.model_name;

-- ---------------------------------------------------------------------------
-- Step 3: Upsert channel (type 62 = ChannelTypeMagic666).
-- ---------------------------------------------------------------------------

WITH channel_seed(name, type, channel_group, models, model_mapping, status, base_url, key, priority, weight, tag) AS (
  VALUES (
    'magic666',
    62,
    'default',
    'gpt-image-2,gpt-image-2-pro,gemini-2.5-flash-image,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gpt-image-2-magic666,gpt-image-2-pro-magic666,gemini-2.5-flash-image-magic666,gemini-3-pro-image-preview-magic666,gemini-3.1-flash-image-preview-magic666',
    $json${
      "gpt-image-2-magic666":                    "gpt-image-2",
      "gpt-image-2-pro-magic666":                "gpt-image-2-pro",
      "gemini-2.5-flash-image-magic666":         "gemini-2.5-flash-image",
      "gemini-3-pro-image-preview-magic666":     "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview-magic666": "gemini-3.1-flash-image-preview"
    }$json$,
    1,
    'http://152.53.38.70:3001',
    'PLACEHOLDER_MAGIC666_KEY',
    0, 0, 'magic666'
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
SET models        = 'gpt-image-2,gpt-image-2-pro,gemini-2.5-flash-image,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gpt-image-2-magic666,gpt-image-2-pro-magic666,gemini-2.5-flash-image-magic666,gemini-3-pro-image-preview-magic666,gemini-3.1-flash-image-preview-magic666',
    model_mapping = $json${
      "gpt-image-2-magic666":                    "gpt-image-2",
      "gpt-image-2-pro-magic666":                "gpt-image-2-pro",
      "gemini-2.5-flash-image-magic666":         "gemini-2.5-flash-image",
      "gemini-3-pro-image-preview-magic666":     "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview-magic666": "gemini-3.1-flash-image-preview"
    }$json$,
    base_url      = 'http://152.53.38.70:3001'
WHERE name = 'magic666' AND type = 62 AND "group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 4: Seed abilities.
-- ---------------------------------------------------------------------------

WITH base_models(base_name) AS (VALUES
  ('gpt-image-2'),
  ('gpt-image-2-pro'),
  ('gemini-2.5-flash-image'),
  ('gemini-3-pro-image-preview'),
  ('gemini-3.1-flash-image-preview')
),
all_model_names AS (
  SELECT base_name AS model FROM base_models
  UNION ALL
  SELECT base_name || '-magic666' FROM base_models
),
ability_matrix AS (
  SELECT g.ability_group, m.model
  FROM all_model_names AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, c.id, true, 0, 0, 'magic666'
FROM ability_matrix AS am
JOIN channels AS c
  ON c.name = 'magic666' AND c.type = 62 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 5: Seed ModelPrice (flat per-task USD).
-- Pricing reference:
--   gpt-image-2        = 5   (matches existing)
--   gpt-image-2-pro    = 8   (pro premium)
--   gemini flash image = 3
--   gemini-3-pro image = 10
-- ---------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${
    "gpt-image-2-pro":                        8,
    "gpt-image-2-pro-magic666":               8,
    "gpt-image-2-magic666":                   5,
    "gemini-2.5-flash-image-magic666":        3,
    "gemini-3-pro-image-preview-magic666":    10,
    "gemini-3.1-flash-image-preview-magic666": 3
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
