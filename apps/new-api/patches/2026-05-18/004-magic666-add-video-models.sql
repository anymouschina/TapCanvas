-- 004-magic666-add-video-models.sql
-- Purpose:
--   Add Magic666 async video models:
--     veo_3_1-fast, veo_3_1-4K, sora-2, sora-2-oai
--   Magic666 uses the OpenAI-style async flow:
--     POST /v1/videos
--     GET  /v1/videos/{task_id}
--
-- Pricing:
--   - sora-2     = 0.2 CNY / call
--   - sora-2-oai = 0.5 CNY / call
--   - veo_3_1-4K reuses existing Veo 3.1 pricing via veo_3_1 tier.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Ensure catalog rows exist and have video params.
-- ---------------------------------------------------------------------------

WITH model_seed(model_name, description) AS (
  VALUES
    ('veo_3_1-fast', 'Magic666 video generation via /v1/videos upstream veo_3_1-fast'),
    ('veo_3_1-4K', 'Magic666 video generation via /v1/videos upstream veo_3_1-4K'),
    ('veo_3_1', 'Magic666 video generation via /v1/videos upstream veo_3_1-4K'),
    ('veo3.1-pro', 'Magic666 video generation via /v1/videos upstream veo_3_1-4K'),
    ('sora-2', 'Magic666 video generation via /v1/videos upstream sora-2'),
    ('sora-2-oai', 'Magic666 video generation via /v1/videos upstream sora-2-oai')
)
INSERT INTO models (
  model_name, description, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  s.model_name,
  s.description,
  v.id,
  '["openai"]',
  'video',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM model_seed s
JOIN vendors v ON v.name = 'Magic666' AND v.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM models m
  WHERE m.model_name = s.model_name
    AND m.deleted_at IS NULL
);

UPDATE models
SET kind         = 'video',
    status       = 1,
    endpoints    = '["openai"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":10,
       "options":[{"value":10,"label":"10s"},{"value":15,"label":"15s"}]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
       "options":[{"value":"720p","label":"720p"}]},
      {"key":"size","type":"enum","label":"尺寸","default":"720x1280",
       "options":[
         {"value":"720x1280","label":"竖屏","aspectRatio":"9:16","orientation":"portrait"},
         {"value":"1280x720","label":"横屏","aspectRatio":"16:9","orientation":"landscape"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('veo_3_1-fast', 'veo_3_1-4K', 'veo_3_1', 'veo3.1-pro', 'sora-2', 'sora-2-oai')
  AND deleted_at IS NULL;

UPDATE models
SET params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":4,
       "options":[{"value":4,"label":"4s"},{"value":8,"label":"8s"},{"value":12,"label":"12s"}]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
       "options":[{"value":"720p","label":"720p"}]},
      {"key":"size","type":"enum","label":"尺寸","default":"720x1280",
       "options":[
         {"value":"720x1280","label":"竖屏","aspectRatio":"9:16","orientation":"portrait"},
         {"value":"1280x720","label":"横屏","aspectRatio":"16:9","orientation":"landscape"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'sora-2-oai'
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Add video models to the existing Magic666 channel.
-- ---------------------------------------------------------------------------

WITH target_channels AS (
  SELECT id
  FROM channels
  WHERE name = 'magic666'
    AND type = 62
    AND "group" = 'default'
),
next_models AS (
  SELECT c.id,
         (
           SELECT string_agg(item, ',' ORDER BY item)
           FROM (
             SELECT DISTINCT item
             FROM (
               SELECT btrim(value) AS item
               FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) AS value
               WHERE btrim(value) <> ''
               UNION ALL SELECT 'veo_3_1-fast'
               UNION ALL SELECT 'veo_3_1-4K'
               UNION ALL SELECT 'veo_3_1'
               UNION ALL SELECT 'veo3.1-pro'
               UNION ALL SELECT 'sora-2'
               UNION ALL SELECT 'sora-2-oai'
             ) raw_items
           ) items
         ) AS models
  FROM channels c
  JOIN target_channels t ON t.id = c.id
)
UPDATE channels c
SET models = n.models
FROM next_models n
WHERE c.id = n.id;

-- ---------------------------------------------------------------------------
-- Step 3: Seed abilities for default + auto.
-- ---------------------------------------------------------------------------

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group,
       m.model_name,
       c.id,
       true,
       c.priority,
       COALESCE(c.weight, 0),
       c.tag
FROM channels c
CROSS JOIN (VALUES
  ('veo_3_1-fast'),
  ('veo_3_1-4K'),
  ('veo_3_1'),
  ('veo3.1-pro'),
  ('sora-2'),
  ('sora-2-oai')
) AS m(model_name)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
WHERE c.name = 'magic666'
  AND c.type = 62
  AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = true,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 4: Prices. Sora prices are per-call; Veo prices reuse the existing Veo family prices.
-- ---------------------------------------------------------------------------

UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"sora-2": 0.2, "sora-2-oai": 0.5, "veo_3_1-fast": 1.3, "veo_3_1-4K": 5.5, "veo_3_1": 5.5, "veo3.1-pro": 5.5}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- ---------------------------------------------------------------------------
-- Verification output for deploy logs.
-- ---------------------------------------------------------------------------

\echo '----- Magic666 video models -----'
SELECT model_name, kind, status
FROM models
WHERE model_name IN ('veo_3_1-fast', 'veo_3_1-4K', 'veo_3_1', 'veo3.1-pro', 'sora-2', 'sora-2-oai')
ORDER BY model_name;

\echo '----- Magic666 channel models -----'
SELECT id, name, type, models
FROM channels
WHERE name = 'magic666' AND type = 62;

\echo '----- Magic666 video abilities -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE c.name = 'magic666'
  AND c.type = 62
  AND a.model IN ('veo_3_1-fast', 'veo_3_1-4K', 'veo_3_1', 'veo3.1-pro', 'sora-2', 'sora-2-oai')
ORDER BY a.model, a."group";

COMMIT;
