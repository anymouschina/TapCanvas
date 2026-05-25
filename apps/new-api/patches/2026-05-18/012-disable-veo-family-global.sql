-- 012-disable-veo-family-global.sql
-- Purpose:
--   Temporarily disable the whole Veo family across new-api. This is broader
--   than the Magic666-only disable patch because /new-api-models reads the
--   canonical new-api model/ability catalog and APIMart/Wuyinkeji/Yunwu Veo
--   aliases can otherwise still surface as public `veo-3.1`.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

WITH veo_models AS (
  SELECT DISTINCT model_name
  FROM models
  WHERE deleted_at IS NULL
    AND lower(model_name) LIKE '%veo%'
),
channel_mapping AS (
  SELECT
    c.id,
    CASE
      WHEN jsonb_typeof(COALESCE(NULLIF(c.model_mapping, '')::jsonb, '{}'::jsonb)) = 'object'
        THEN COALESCE(NULLIF(c.model_mapping, '')::jsonb, '{}'::jsonb)
      ELSE '{}'::jsonb
    END AS mapping
  FROM channels c
),
target_channels AS (
  SELECT DISTINCT c.id
  FROM channels c
  JOIN channel_mapping cm ON cm.id = c.id
  WHERE (
      EXISTS (
        SELECT 1
        FROM veo_models vm
        WHERE position(vm.model_name in COALESCE(c.models, '')) > 0
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_object_keys(cm.mapping) AS k(key)
        WHERE lower(k.key) LIKE '%veo%'
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_each(cm.mapping) AS m(key, value)
        WHERE lower(m.value #>> '{}') LIKE '%veo%'
      )
    )
),
next_channel_state AS (
  SELECT c.id,
         (
           SELECT string_agg(item, ',' ORDER BY item)
           FROM (
             SELECT DISTINCT btrim(value) AS item
             FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) AS value
             WHERE btrim(value) <> ''
               AND lower(btrim(value)) NOT LIKE '%veo%'
           ) items
         ) AS models,
         (
           SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)::text
           FROM jsonb_each(cm.mapping)
           WHERE lower(key) NOT LIKE '%veo%'
             AND lower(value #>> '{}') NOT LIKE '%veo%'
         ) AS model_mapping
  FROM channels c
  JOIN target_channels tc ON tc.id = c.id
  JOIN channel_mapping cm ON cm.id = c.id
)
UPDATE channels c
SET models        = COALESCE(n.models, ''),
    model_mapping = n.model_mapping
FROM next_channel_state n
WHERE c.id = n.id;

UPDATE abilities
SET enabled = false
WHERE lower(model) LIKE '%veo%';

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE deleted_at IS NULL
  AND lower(model_name) LIKE '%veo%';

UPDATE options
SET value = (
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)::text
  FROM jsonb_each(
    CASE
      WHEN jsonb_typeof(COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb)) = 'object'
        THEN COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb)
      ELSE '{}'::jsonb
    END
  )
  WHERE lower(key) NOT LIKE '%veo%'
)
WHERE key = 'ModelPrice';

\echo '----- Veo models after global disable -----'
SELECT id, model_name, status, vendor_id
FROM models
WHERE deleted_at IS NULL
  AND lower(model_name) LIKE '%veo%'
ORDER BY model_name;

\echo '----- Veo abilities after global disable -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name
FROM abilities a
LEFT JOIN channels c ON c.id = a.channel_id
WHERE lower(a.model) LIKE '%veo%'
ORDER BY a.model, a."group", c.name;

\echo '----- Channels still mentioning Veo -----'
SELECT id, name, type, models, model_mapping
FROM channels
WHERE (
    lower(COALESCE(models, '')) LIKE '%veo%'
    OR lower(COALESCE(model_mapping, '')) LIKE '%veo%'
  )
ORDER BY id;

COMMIT;
