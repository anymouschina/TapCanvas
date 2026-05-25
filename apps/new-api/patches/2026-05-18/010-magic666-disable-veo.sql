-- 010-magic666-disable-veo.sql
-- Purpose:
--   Magic666 has delisted the Veo family. Remove Veo from the Magic666 channel
--   and disable all Magic666 Veo abilities/model catalog rows.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

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
                 AND btrim(value) NOT IN (
                   'veo-3.1',
                   'veo_3_1',
                   'veo_3_1-4K',
                   'veo_3_1-fast',
                   'veo_3_1-fast-4K',
                   'veo_3_1-components',
                   'veo_3_1-components-4K',
                   'veo_3_1-fast-components',
                   'veo_3_1-fast-components-4K',
                   'veo3.1-pro',
                   'veo3.1-fast'
                 )
             ) raw_items
           ) items
         ) AS models,
         (
           COALESCE(NULLIF(c.model_mapping, '')::jsonb, '{}'::jsonb)
           - 'veo-3.1'
           - 'veo_3_1'
           - 'veo_3_1-4K'
           - 'veo_3_1-fast'
           - 'veo_3_1-fast-4K'
           - 'veo_3_1-components'
           - 'veo_3_1-components-4K'
           - 'veo_3_1-fast-components'
           - 'veo_3_1-fast-components-4K'
           - 'veo3.1-pro'
           - 'veo3.1-fast'
         )::text AS model_mapping
  FROM channels c
  JOIN target_channels t ON t.id = c.id
)
UPDATE channels c
SET models        = COALESCE(n.models, ''),
    model_mapping = n.model_mapping
FROM next_channel_state n
WHERE c.id = n.id;

UPDATE abilities a
SET enabled = false
FROM channels c
WHERE c.id = a.channel_id
  AND c.name = 'magic666'
  AND c.type = 62
  AND a.model IN (
    'veo-3.1',
    'veo_3_1',
    'veo_3_1-4K',
    'veo_3_1-fast',
    'veo_3_1-fast-4K',
    'veo_3_1-components',
    'veo_3_1-components-4K',
    'veo_3_1-fast-components',
    'veo_3_1-fast-components-4K',
    'veo3.1-pro',
    'veo3.1-fast'
  );

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
    'veo-3.1',
    'veo_3_1',
    'veo_3_1-4K',
    'veo_3_1-fast',
    'veo_3_1-fast-4K',
    'veo_3_1-components',
    'veo_3_1-components-4K',
    'veo_3_1-fast-components',
    'veo_3_1-fast-components-4K',
    'veo3.1-pro',
    'veo3.1-fast'
  )
  AND deleted_at IS NULL;

\echo '----- Magic666 channel models after Veo disable -----'
SELECT id, name, type, models, model_mapping
FROM channels
WHERE name = 'magic666' AND type = 62;

\echo '----- Magic666 Veo abilities after disable -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE c.name = 'magic666'
  AND c.type = 62
  AND a.model IN (
    'veo-3.1',
    'veo_3_1',
    'veo_3_1-4K',
    'veo_3_1-fast',
    'veo_3_1-fast-4K',
    'veo_3_1-components',
    'veo_3_1-components-4K',
    'veo_3_1-fast-components',
    'veo_3_1-fast-components-4K',
    'veo3.1-pro',
    'veo3.1-fast'
  )
ORDER BY a.model, a."group";

COMMIT;
