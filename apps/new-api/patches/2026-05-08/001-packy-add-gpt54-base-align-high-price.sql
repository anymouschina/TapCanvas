-- 001-packy-add-gpt54-base-align-high-price.sql
-- Purpose:
--   1. Ensure gpt-5.4 (base) is present in the packyapi-gpt5x channel and abilities.
--   2. Align gpt-5.4 pricing to gpt-5.4-high (overrides the 1.0 ModelRatio correction
--      applied in patches/2026-04-29/002).
--
-- Pricing (packy procurement +50%, same as gpt-5.4-high):
--   input   $0.9375/M  -> ModelRatio     = 0.9375 / 2.0 = 0.46875
--   output  $5.625/M   -> CompletionRatio = 5.625 / 0.9375 = 6.0
--   cache   $0.0945/M  -> CacheRatio      = 0.0945 / 0.9375 ≈ 0.1008
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.
-- After applying: restart new-api or clear pricing cache.

\set ON_ERROR_STOP on

BEGIN;

-- Step 1: Ensure gpt-5.4 model row exists.
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints,
  kind, status, sync_official, created_time, updated_time, name_rule
)
SELECT
  'gpt-5.4',
  'PackyAPI upstream gpt-5.4',
  NULL,
  NULL,
  v.id,
  NULL,
  'chat',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM (SELECT id FROM vendors WHERE name = 'PackyAPI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gpt-5.4' AND deleted_at IS NULL
);

-- Step 2: Add gpt-5.4 to packyapi-gpt5x channel models list (idempotent).
UPDATE channels
SET
  models = CASE
    WHEN models LIKE '%gpt-5.4,%' OR models LIKE '%,gpt-5.4' OR models = 'gpt-5.4'
      THEN models
    ELSE models || ',gpt-5.4'
  END
WHERE name = 'packyapi-gpt5x' AND type = 1 AND "group" = 'default';

-- Step 3: Upsert ability for gpt-5.4 via packyapi-gpt5x channel.
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  g.ability_group,
  'gpt-5.4',
  c.id,
  true,
  0,
  0,
  'packyapi'
FROM (VALUES ('default'), ('auto')) AS g(ability_group)
JOIN channels AS c
  ON c.name = 'packyapi-gpt5x' AND c.type = 1 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled  = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight   = EXCLUDED.weight,
  tag      = EXCLUDED.tag;

-- Step 4: Align gpt-5.4 pricing to gpt-5.4-high.
UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"gpt-5.4": 0.46875}'::jsonb
)::text
WHERE key = 'ModelRatio';

UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"gpt-5.4": 6.0}'::jsonb
)::text
WHERE key = 'CompletionRatio';

UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"gpt-5.4": 0.1008}'::jsonb
)::text
WHERE key = 'CacheRatio';

\echo
\echo '----- packy gpt-5.4 base channel + pricing -----'
SELECT c.id, c.name, c.models
FROM channels AS c
WHERE c.name = 'packyapi-gpt5x' AND c.type = 1 AND c."group" = 'default';

SELECT key,
  value::jsonb -> 'gpt-5.4'      AS gpt_54,
  value::jsonb -> 'gpt-5.4-high' AS gpt_54_high,
  value::jsonb -> 'gpt-5.4-mini' AS gpt_54_mini
FROM options
WHERE key IN ('ModelRatio', 'CompletionRatio', 'CacheRatio')
ORDER BY key;

COMMIT;
