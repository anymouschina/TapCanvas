-- 002-correct-gpt-image-2-channel-tier-bindings.sql
-- Purpose:
--   Make the database the source of truth for gpt-image-2 resolution tier
--   routing. gpt-image-2-pro is a Magic666 upstream tier; gpt-image-2-vip is a
--   RightCode upstream tier. The relay reads the selected channel's models list
--   and picks the same-channel tier model for non-1K requests.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Keep internal tier model rows hidden from the public catalog.
-- ---------------------------------------------------------------------------

UPDATE models
SET status       = 0,
    kind         = 'image',
    name_rule    = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('gpt-image-2-pro', 'gpt-image-2-vip')
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Magic666 channels bind gpt-image-2 + gpt-image-2-pro only.
-- ---------------------------------------------------------------------------

WITH magic_channels AS (
  SELECT id
  FROM channels
  WHERE type = 62
    AND COALESCE(models, '') LIKE '%gpt-image-2%'
),
magic_next_models AS (
  SELECT c.id,
         (
           SELECT string_agg(item, ',' ORDER BY sort_key, item)
           FROM (
             SELECT item,
                    MIN(CASE item
                      WHEN 'gpt-image-2' THEN 0
                      WHEN 'gpt-image-2-pro' THEN 1
                      ELSE 2
                    END) AS sort_key
             FROM (
               SELECT btrim(value) AS item
               FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) AS value
               WHERE btrim(value) <> ''
                 AND btrim(value) <> 'gpt-image-2-vip'
               UNION ALL SELECT 'gpt-image-2'
               UNION ALL SELECT 'gpt-image-2-pro'
             ) AS items
             GROUP BY item
           ) AS sorted_items
         ) AS models
  FROM channels c
  JOIN magic_channels mc ON mc.id = c.id
)
UPDATE channels c
SET models = mn.models
FROM magic_next_models mn
WHERE c.id = mn.id;

UPDATE channels
SET model_mapping = (
      COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
      - 'gpt-image-2-pro'
      - 'gpt-image-2-vip'
      - 'gpt-image-2-pro-magic666'
      - 'gpt-image-2-vip-magic666'
    )::text
WHERE type = 62
  AND model_mapping IS NOT NULL
  AND model_mapping <> ''
  AND (
    COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-pro'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-vip'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-pro-magic666'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-vip-magic666'
  );

-- ---------------------------------------------------------------------------
-- Step 3: RightCode channels bind gpt-image-2 + gpt-image-2-vip only.
-- ---------------------------------------------------------------------------

WITH rightcode_channels AS (
  SELECT id
  FROM channels
  WHERE type = 60
    AND COALESCE(models, '') LIKE '%gpt-image-2%'
),
rightcode_next_models AS (
  SELECT c.id,
         (
           SELECT string_agg(item, ',' ORDER BY sort_key, item)
           FROM (
             SELECT item,
                    MIN(CASE item
                      WHEN 'gpt-image-2' THEN 0
                      WHEN 'gpt-image-2-vip' THEN 1
                      ELSE 2
                    END) AS sort_key
             FROM (
               SELECT btrim(value) AS item
               FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) AS value
               WHERE btrim(value) <> ''
                 AND btrim(value) <> 'gpt-image-2-pro'
               UNION ALL SELECT 'gpt-image-2'
               UNION ALL SELECT 'gpt-image-2-vip'
             ) AS items
             GROUP BY item
           ) AS sorted_items
         ) AS models
  FROM channels c
  JOIN rightcode_channels rc ON rc.id = c.id
)
UPDATE channels c
SET models = rn.models
FROM rightcode_next_models rn
WHERE c.id = rn.id;

UPDATE channels
SET model_mapping = (
      COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
      - 'gpt-image-2-pro'
      - 'gpt-image-2-pro-magic666'
      - 'gpt-image-2-vip'
    )::text
WHERE type = 60
  AND model_mapping IS NOT NULL
  AND model_mapping <> ''
  AND (
    COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-pro'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-pro-magic666'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-vip'
  );

-- ---------------------------------------------------------------------------
-- Step 4: Sync abilities from the corrected channel models for default/auto.
-- Priority/weight follow the channel row; tier rows stay internal but routable.
-- ---------------------------------------------------------------------------

WITH tier_channel_models AS (
  SELECT c.id AS channel_id,
         c.type AS channel_type,
         c.priority,
         COALESCE(c.weight, 0) AS weight,
         c.tag,
         normalized.model_name
  FROM channels c
  CROSS JOIN LATERAL unnest(string_to_array(COALESCE(c.models, ''), ',')) AS raw_model(raw_value)
  CROSS JOIN LATERAL (SELECT btrim(raw_model.raw_value) AS model_name) AS normalized
  WHERE c.type IN (60, 62)
    AND normalized.model_name IN ('gpt-image-2-pro', 'gpt-image-2-vip')
),
valid_tier_channel_models AS (
  SELECT *
  FROM tier_channel_models
  WHERE (channel_type = 62 AND model_name = 'gpt-image-2-pro')
     OR (channel_type = 60 AND model_name = 'gpt-image-2-vip')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group,
       v.model_name,
       v.channel_id,
       true,
       v.priority,
       v.weight,
       v.tag
FROM valid_tier_channel_models v
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = true,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- Disable tier abilities on the wrong channel type so cache selection cannot
-- route a tier model to a channel that does not own it.
UPDATE abilities a
SET enabled = false
FROM channels c
WHERE c.id = a.channel_id
  AND (
    (a.model = 'gpt-image-2-vip' AND c.type = 62)
    OR (a.model = 'gpt-image-2-pro' AND c.type = 60)
  );

-- ---------------------------------------------------------------------------
-- Verification output for deploy logs.
-- ---------------------------------------------------------------------------

\echo '----- GPT Image 2 tier channel bindings -----'
SELECT id, name, type, models
FROM channels
WHERE type IN (60, 62)
  AND models LIKE '%gpt-image-2%'
ORDER BY type, name;

\echo '----- GPT Image 2 tier abilities -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name, c.type AS channel_type
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE a.model IN ('gpt-image-2-pro', 'gpt-image-2-vip')
ORDER BY a.model, a."group", c.type, c.name;

COMMIT;
