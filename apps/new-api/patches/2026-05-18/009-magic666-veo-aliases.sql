-- 009-magic666-veo-aliases.sql
-- Purpose: let canonical Veo 3.1 requests route through the configured Magic666 channel.
--
-- Magic666 exposes veo_3_1-fast and veo_3_1-4K. Existing clients may request
-- veo_3_1 or veo3.1-pro, so this patch binds those public keys to the
-- Magic666 channel and maps them to the Magic666 upstream model.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

WITH model_seed(model_name, description) AS (
  VALUES
    ('veo_3_1', 'Magic666 video generation via /v1/videos upstream veo_3_1-4K'),
    ('veo3.1-pro', 'Magic666 video generation via /v1/videos upstream veo_3_1-4K')
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
WHERE model_name IN ('veo_3_1', 'veo3.1-pro')
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
               UNION ALL SELECT 'veo_3_1'
               UNION ALL SELECT 'veo3.1-pro'
             ) raw_items
           ) items
         ) AS models,
         (
           COALESCE(NULLIF(c.model_mapping, '')::jsonb, '{}'::jsonb)
           || '{"veo_3_1":"veo_3_1-4K","veo3.1-pro":"veo_3_1-4K"}'::jsonb
         )::text AS model_mapping
  FROM channels c
  JOIN target_channels t ON t.id = c.id
)
UPDATE channels c
SET models        = n.models,
    model_mapping = n.model_mapping
FROM next_channel_state n
WHERE c.id = n.id;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group,
       m.model_name,
       c.id,
       true,
       c.priority,
       COALESCE(c.weight, 0),
       c.tag
FROM channels c
CROSS JOIN (VALUES ('veo_3_1'), ('veo3.1-pro')) AS m(model_name)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
WHERE c.name = 'magic666'
  AND c.type = 62
  AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = true,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"veo_3_1": 5.5, "veo3.1-pro": 5.5}'::jsonb
)::text
WHERE key = 'ModelPrice';

COMMIT;
