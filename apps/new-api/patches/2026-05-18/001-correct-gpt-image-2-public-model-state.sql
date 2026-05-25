-- 001-correct-gpt-image-2-public-model-state.sql
-- Purpose:
--   Correct gpt-image-2 public model visibility after mixed historical patches.
--
-- Target state:
--   - gpt-image-2 and gpt-image-2-official are public consumable SKUs.
--   - gemini-3-pro-image-preview-official is also a public consumable SKU.
--   - gpt-image-2-pro / gpt-image-2-vip and vendor-suffixed aliases are
--     internal routing rows, not public selectable models.
--   - Existing channels, API keys, channel status and channel priority are not
--     modified.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Keep public canonical/official image SKUs visible and image-capable.
-- ---------------------------------------------------------------------------

UPDATE models
SET status       = 1,
    kind         = 'image',
    name_rule    = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
    'gpt-image-2',
    'gpt-image-2-official',
    'gemini-3-pro-image-preview-official'
  )
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Hide retired/public-confusing GPT Image 2 tiers and aliases.
-- They may still exist for audit or internal routing, but must not appear as
-- public selectable models.
-- ---------------------------------------------------------------------------

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
    'gpt-image-2-pro',
    'gpt-image-2-vip',
    'gpt-image-2-all',
    'gpt-image-2-apimart',
    'gpt-image-2-rightcodes',
    'gpt-image-2-suchuang',
    'gpt-image-2-magic666',
    'gpt-image-2-pro-magic666',
    'gpt-image-2-vip-magic666'
  )
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 3: Prevent retired public aliases from being synced back into catalog
-- through enabled default abilities. Internal fallback model abilities for
-- gpt-image-2-pro / gpt-image-2-vip are intentionally left untouched.
-- ---------------------------------------------------------------------------

UPDATE abilities
SET enabled = false
WHERE model IN (
    'gpt-image-2-all',
    'gpt-image-2-apimart',
    'gpt-image-2-rightcodes',
    'gpt-image-2-suchuang',
    'gpt-image-2-magic666',
    'gpt-image-2-pro-magic666',
    'gpt-image-2-vip-magic666'
  );

-- ---------------------------------------------------------------------------
-- Step 4: Remove stale vendor-suffixed aliases from channel model lists and
-- mappings. Do not touch keys/status/priority or the public canonical/official
-- routing entries.
-- ---------------------------------------------------------------------------

UPDATE channels
SET models = array_to_string(
      ARRAY(
        SELECT item
        FROM unnest(string_to_array(COALESCE(models, ''), ',')) AS item
        WHERE btrim(item) NOT IN (
          'gpt-image-2-all',
          'gpt-image-2-apimart',
          'gpt-image-2-rightcodes',
          'gpt-image-2-suchuang',
          'gpt-image-2-magic666',
          'gpt-image-2-pro-magic666',
          'gpt-image-2-vip-magic666'
        )
      ),
      ','
    )
WHERE models IS NOT NULL
  AND (
    models LIKE '%gpt-image-2-all%'
    OR models LIKE '%gpt-image-2-apimart%'
    OR models LIKE '%gpt-image-2-rightcodes%'
    OR models LIKE '%gpt-image-2-suchuang%'
    OR models LIKE '%gpt-image-2-magic666%'
  );

UPDATE channels
SET model_mapping = (
      COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
      - 'gpt-image-2-all'
      - 'gpt-image-2-apimart'
      - 'gpt-image-2-rightcodes'
      - 'gpt-image-2-suchuang'
      - 'gpt-image-2-magic666'
      - 'gpt-image-2-pro-magic666'
      - 'gpt-image-2-vip-magic666'
    )::text
WHERE model_mapping IS NOT NULL
  AND model_mapping <> ''
  AND (
    COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-all'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-apimart'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-rightcodes'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-suchuang'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-magic666'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-pro-magic666'
    OR COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-vip-magic666'
  );

-- ---------------------------------------------------------------------------
-- Verification output for deploy logs.
-- ---------------------------------------------------------------------------

\echo '----- GPT Image 2 public model state -----'
SELECT model_name, status, kind, deleted_at
FROM models
WHERE model_name LIKE 'gpt-image-2%'
ORDER BY model_name;

\echo '----- GPT Image 2 active default abilities -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name, c.type AS channel_type
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE a.model LIKE 'gpt-image-2%'
  AND a.enabled = true
  AND a."group" IN ('default', 'auto')
ORDER BY a.model, a."group", c.name;

COMMIT;
