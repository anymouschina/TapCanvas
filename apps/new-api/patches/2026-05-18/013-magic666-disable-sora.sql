-- 013-magic666-disable-sora.sql
-- Purpose:
--   Temporarily disable Magic666 Sora video generation. This keeps the system
--   on a single explicit new-api catalog path: no Hono fallback, no hidden
--   route downgrade. A later patch can re-enable `sora2` when the channel is
--   ready again.
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
channel_mapping AS (
  SELECT
    c.id,
    CASE
      WHEN jsonb_typeof(COALESCE(NULLIF(c.model_mapping, '')::jsonb, '{}'::jsonb)) = 'object'
        THEN COALESCE(NULLIF(c.model_mapping, '')::jsonb, '{}'::jsonb)
      ELSE '{}'::jsonb
    END AS mapping
  FROM channels c
  JOIN target_channels t ON t.id = c.id
),
next_channel_state AS (
  SELECT c.id,
         (
           SELECT string_agg(item, ',' ORDER BY item)
           FROM (
             SELECT DISTINCT btrim(value) AS item
             FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) AS value
             WHERE btrim(value) <> ''
               AND btrim(value) NOT IN ('sora2', 'sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s')
           ) items
         ) AS models,
         (
           cm.mapping
           - 'sora2'
           - 'sora-2'
           - 'sora-2-oai'
           - 'sora-2-8s'
           - 'sora-2-12s'
         )::text AS model_mapping
  FROM channels c
  JOIN target_channels t ON t.id = c.id
  JOIN channel_mapping cm ON cm.id = c.id
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
  AND a.model IN ('sora2', 'sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s');

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('sora2', 'sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s')
  AND vendor_id IN (
    SELECT id
    FROM vendors
    WHERE name = 'Magic666'
      AND deleted_at IS NULL
  )
  AND deleted_at IS NULL;

UPDATE options
SET value = (
  (CASE
    WHEN jsonb_typeof(COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)) = 'object'
      THEN COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
    ELSE '{}'::jsonb
  END
    - 'sora2'
    - 'sora-2'
    - 'sora-2-oai'
    - 'sora-2-8s'
    - 'sora-2-12s')
)::text
WHERE key = 'ModelPrice';

\echo '----- Magic666 channel models after Sora disable -----'
SELECT id, name, type, models, model_mapping
FROM channels
WHERE name = 'magic666' AND type = 62;

\echo '----- Magic666 Sora abilities after disable -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE c.name = 'magic666'
  AND c.type = 62
  AND a.model IN ('sora2', 'sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s')
ORDER BY a.model, a."group";

\echo '----- Magic666 Sora model rows after disable -----'
SELECT m.id, m.model_name, m.status, m.vendor_id
FROM models m
JOIN vendors v ON v.id = m.vendor_id
WHERE v.name = 'Magic666'
  AND m.deleted_at IS NULL
  AND m.model_name IN ('sora2', 'sora-2', 'sora-2-oai', 'sora-2-8s', 'sora-2-12s')
ORDER BY m.model_name;

COMMIT;
