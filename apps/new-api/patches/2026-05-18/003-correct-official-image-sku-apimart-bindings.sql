-- 003-correct-official-image-sku-apimart-bindings.sql
-- Purpose:
--   Treat official image models as independent APIMart SKUs:
--     - gpt-image-2-official
--     - gemini-3-pro-image-preview-official
--   They remain public consumable models, but must not be used as fallback
--   tiers for base models and must not be routed through Magic666/RightCode.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Keep official SKUs visible and image-capable.
-- ---------------------------------------------------------------------------

UPDATE models
SET status       = 1,
    kind         = 'image',
    name_rule    = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
    'gpt-image-2-official',
    'gemini-3-pro-image-preview-official'
  )
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Bind official SKUs only to APIMart channels.
-- ---------------------------------------------------------------------------

WITH apimart_channels AS (
  SELECT id
  FROM channels
  WHERE type = 59
    AND (
      COALESCE(models, '') LIKE '%gpt-image-2%'
      OR COALESCE(models, '') LIKE '%gemini-3-pro-image-preview%'
    )
),
apimart_next_models AS (
  SELECT c.id,
         (
           SELECT string_agg(item, ',' ORDER BY sort_key, item)
           FROM (
             SELECT item,
                    MIN(CASE item
                      WHEN 'gpt-image-2' THEN 0
                      WHEN 'gpt-image-2-official' THEN 1
                      WHEN 'gemini-3-pro-image-preview' THEN 2
                      WHEN 'gemini-3-pro-image-preview-official' THEN 3
                      ELSE 4
                    END) AS sort_key
             FROM (
               SELECT btrim(value) AS item
               FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) AS value
               WHERE btrim(value) <> ''
               UNION ALL SELECT 'gpt-image-2-official'
               UNION ALL SELECT 'gemini-3-pro-image-preview-official'
             ) AS items
             GROUP BY item
           ) AS sorted_items
         ) AS models
  FROM channels c
  JOIN apimart_channels ac ON ac.id = c.id
)
UPDATE channels c
SET models = an.models
FROM apimart_next_models an
WHERE c.id = an.id;

-- ---------------------------------------------------------------------------
-- Step 3: Remove official SKUs from non-APIMart image tier channels.
-- ---------------------------------------------------------------------------

UPDATE channels
SET models = array_to_string(
      ARRAY(
        SELECT btrim(item)
        FROM unnest(string_to_array(COALESCE(models, ''), ',')) AS item
        WHERE btrim(item) NOT IN (
          'gpt-image-2-official',
          'gemini-3-pro-image-preview-official'
        )
      ),
      ','
    )
WHERE type IN (60, 62)
  AND (
    COALESCE(models, '') LIKE '%gpt-image-2-official%'
    OR COALESCE(models, '') LIKE '%gemini-3-pro-image-preview-official%'
  );

UPDATE channels
SET model_mapping = (
      COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
      - 'gpt-image-2-official'
      - 'gemini-3-pro-image-preview-official'
    )::text
WHERE type IN (60, 62)
  AND model_mapping IS NOT NULL
  AND model_mapping <> ''
  AND (
    COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-official'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gemini-3-pro-image-preview-official'
  );

-- ---------------------------------------------------------------------------
-- Step 4: Abilities: enable official SKUs on APIMart, disable on Magic/RightCode.
-- ---------------------------------------------------------------------------

WITH apimart_official_models AS (
  SELECT c.id AS channel_id,
         c.priority,
         COALESCE(c.weight, 0) AS weight,
         c.tag,
         official.model_name
  FROM channels c
  CROSS JOIN (VALUES
    ('gpt-image-2-official'),
    ('gemini-3-pro-image-preview-official')
  ) AS official(model_name)
  WHERE c.type = 59
    AND COALESCE(c.models, '') LIKE '%' || official.model_name || '%'
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group,
       a.model_name,
       a.channel_id,
       true,
       a.priority,
       a.weight,
       a.tag
FROM apimart_official_models a
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = true,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

UPDATE abilities a
SET enabled = false
FROM channels c
WHERE c.id = a.channel_id
  AND c.type IN (60, 62)
  AND a.model IN (
    'gpt-image-2-official',
    'gemini-3-pro-image-preview-official'
  );

-- ---------------------------------------------------------------------------
-- Verification output for deploy logs.
-- ---------------------------------------------------------------------------

\echo '----- Official image SKU channel bindings -----'
SELECT id, name, type, models
FROM channels
WHERE models LIKE '%gpt-image-2-official%'
   OR models LIKE '%gemini-3-pro-image-preview-official%'
ORDER BY type, name;

\echo '----- Official image SKU abilities -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name, c.type AS channel_type
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE a.model IN (
  'gpt-image-2-official',
  'gemini-3-pro-image-preview-official'
)
ORDER BY a.model, a."group", c.type, c.name;

COMMIT;
