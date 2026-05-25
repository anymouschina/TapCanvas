-- 011-magic666-sora2-single-model.sql
-- Purpose:
--   Magic666 exposes a single public Sora model key: sora2.
--   The adaptor maps duration to upstream model:
--     4s  -> sora-2
--     8s  -> sora-2-8s
--     12s -> sora-2-12s
--
-- Pricing:
--   4s  = ¥0.4
--   8s  = ¥0.8
--   12s = ¥1.2
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

WITH magic_vendor AS (
  SELECT id
  FROM vendors
  WHERE name = 'Magic666'
    AND deleted_at IS NULL
  LIMIT 1
)
INSERT INTO models (
  model_name, description, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, params_def
)
SELECT
  'sora2',
  'Magic666 Sora2 unified video model via /v1/videos',
  magic_vendor.id,
  '["openai"]',
  'video',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  $json$[
    {"key":"duration","type":"enum","label":"时长","default":4,
     "options":[{"value":4,"label":"4s"},{"value":8,"label":"8s"},{"value":12,"label":"12s"}]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"720p","label":"720p"}]},
    {"key":"size","type":"enum","label":"尺寸","default":"720x1280",
     "options":[
       {"value":"720x1280","label":"竖屏","aspectRatio":"9:16","orientation":"portrait"},
       {"value":"1280x720","label":"横屏","aspectRatio":"16:9","orientation":"landscape"}
     ]}
  ]$json$
FROM magic_vendor
WHERE NOT EXISTS (
  SELECT 1
  FROM models m
  WHERE m.model_name = 'sora2'
    AND m.deleted_at IS NULL
);

UPDATE models
SET description  = 'Magic666 Sora2 unified video model via /v1/videos',
    kind         = 'video',
    status       = 1,
    endpoints    = '["openai"]',
    params_def   = $json$[
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
WHERE model_name = 'sora2'
  AND deleted_at IS NULL;

WITH target_channels AS (
  SELECT id
  FROM channels
  WHERE name = 'magic666'
    AND type = 62
    AND "group" = 'default'
),
next_channel_state AS (
  SELECT c.id,
         (
           SELECT string_agg(item, ',' ORDER BY item)
           FROM (
             SELECT DISTINCT item
             FROM (
               SELECT btrim(value) AS item
               FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) AS value
               WHERE btrim(value) <> ''
                 AND btrim(value) NOT IN ('sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s')
               UNION ALL SELECT 'sora2'
             ) raw_items
           ) items
         ) AS models,
         (
           COALESCE(NULLIF(c.model_mapping, '')::jsonb, '{}'::jsonb)
           - 'sora-2'
           - 'sora-2-oai'
           - 'sora-2-8s'
           - 'sora-2-12s'
         )::text AS model_mapping
  FROM channels c
  JOIN target_channels t ON t.id = c.id
)
UPDATE channels c
SET models        = n.models,
    model_mapping = n.model_mapping
FROM next_channel_state n
WHERE c.id = n.id;

UPDATE abilities a
SET enabled = false
FROM channels c
WHERE c.id = a.channel_id
  AND c.name = 'magic666'
  AND c.type = 62
  AND a.model IN ('sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s');

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group,
       'sora2',
       c.id,
       true,
       c.priority,
       COALESCE(c.weight, 0),
       c.tag
FROM channels c
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
WHERE c.name = 'magic666'
  AND c.type = 62
  AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = true,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s')
  AND vendor_id IN (
    SELECT id FROM vendors WHERE name = 'Magic666' AND deleted_at IS NULL
  )
  AND deleted_at IS NULL;

UPDATE options
SET value = (
  (COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
    - 'sora-2'
    - 'sora-2-oai'
    - 'sora-2-8s'
    - 'sora-2-12s')
  || '{"sora2": 0.4}'::jsonb
)::text
WHERE key = 'ModelPrice';

\echo '----- Magic666 Sora2 channel models -----'
SELECT id, name, type, models, model_mapping
FROM channels
WHERE name = 'magic666' AND type = 62;

\echo '----- Magic666 Sora2 abilities -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE c.name = 'magic666'
  AND c.type = 62
  AND a.model IN ('sora2', 'sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s')
ORDER BY a.model, a."group";

\echo '----- Magic666 Sora2 ModelPrice -----'
SELECT value::jsonb -> 'sora2' AS sora2_price
FROM options
WHERE key = 'ModelPrice';

COMMIT;
