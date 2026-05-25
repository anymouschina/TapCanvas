-- 006-magic666-add-gpt55-responses.sql
-- Purpose:
--   Let the Magic666 channel serve gpt-5.5 through the native OpenAI
--   Responses API:
--     POST http://152.53.38.70:3001/v1/responses
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- Ensure the public canonical model exists and advertises the responses endpoint.
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'gpt-5.5',
  'gpt-5.5 via Magic666 OpenAI Responses API',
  NULL,
  NULL,
  v.id,
  '["openai-response"]',
  'text',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM (SELECT id FROM vendors WHERE name = 'Magic666' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gpt-5.5' AND deleted_at IS NULL
);

UPDATE models
SET kind         = 'text',
    status       = 1,
    endpoints    = '["openai-response"]',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-5.5'
  AND deleted_at IS NULL;

-- Add gpt-5.5 to the existing Magic666 channel without disturbing keys/status.
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
               UNION ALL SELECT 'gpt-5.5'
             ) raw_items
           ) items
         ) AS models
  FROM channels c
  JOIN target_channels t ON t.id = c.id
)
UPDATE channels c
SET models   = n.models,
    base_url = 'http://152.53.38.70:3001'
FROM next_models n
WHERE c.id = n.id;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group,
       'gpt-5.5',
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

-- Keep the existing gpt-5.5 pricing policy if present; otherwise seed the
-- current TapCanvas gpt-5.5 policy.
INSERT INTO options (key, value)
VALUES ('ModelRatio', '{"gpt-5.5": 1.5}')
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

INSERT INTO options (key, value)
VALUES ('CompletionRatio', '{"gpt-5.5": 6.0}')
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

INSERT INTO options (key, value)
VALUES ('CacheRatio', '{"gpt-5.5": 0.0}')
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

INSERT INTO options (key, value)
VALUES ('CreateCacheRatio', '{"gpt-5.5": 0.1}')
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo '----- Magic666 gpt-5.5 responses binding -----'
SELECT m.model_name, m.kind, m.status, m.endpoints
FROM models m
WHERE m.model_name = 'gpt-5.5'
  AND m.deleted_at IS NULL;

SELECT c.id, c.name, c.type, c.base_url, c.models
FROM channels c
WHERE c.name = 'magic666'
  AND c.type = 62
  AND c."group" = 'default';

SELECT a."group", a.model, a.enabled, c.name AS channel_name
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE a.model = 'gpt-5.5'
  AND c.name = 'magic666'
ORDER BY a."group";

COMMIT;
