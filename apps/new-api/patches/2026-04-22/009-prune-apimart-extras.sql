-- 009-prune-apimart-extras.sql
-- Purpose: clean up rows left behind by an earlier, wider version of patch
--          008-add-apimart-channel.sql which seeded 79 APIMart real ids
--          (plus 79 -apimart aliases), before the catalog was scoped down
--          to 9 business-aligned models.
--
-- Actions:
--   1. Delete abilities tagged 'apimart' whose model is NOT in the KEEP set.
--   2. Soft-delete (deleted_at = NOW()) APIMart-owned models whose name is
--      NOT in the KEEP set. vendor_id is used to scope so we never touch
--      models owned by yunwu / wuyinkeji / comfly / ark-doubao-video.
--   3. Prune options.ModelPrice and options.ModelRatio of every stale key.
--
-- KEEP set (kept in lockstep with 008-add-apimart-channel.sql):
--   gemini-2.5-pro                     (chat)
--   gpt-image-2                        (image)
--   gemini-2.5-flash-image-preview     (image)
--   gemini-3-pro-image-preview         (image)
--   gemini-3.1-flash-image-preview     (image)
--   veo3.1-fast                        (video)
--   kling-v3                           (video)
--   doubao-seedance-2.0                (video)
--   doubao-seedance-2.0-fast           (video)
--
-- Both the real id and the <id>-apimart alias are retained for each entry.
--
-- Scope: PostgreSQL only, data-only, idempotent (re-running finds nothing
--        to delete/update).

BEGIN;

-- Single source of truth for the KEEP set, in both real and aliased form.
-- Expressed as a VALUES list so each step below can reference it via a CTE.

WITH keep_base(base_name) AS (VALUES
  ('gemini-2.5-pro'),
  ('gpt-image-2'),
  ('gemini-2.5-flash-image-preview'),
  ('gemini-3-pro-image-preview'),
  ('gemini-3.1-flash-image-preview'),
  ('veo3.1-fast'),
  ('kling-v3'),
  ('doubao-seedance-2.0'),
  ('doubao-seedance-2.0-fast')
),
keep_names AS (
  SELECT base_name AS model_name FROM keep_base
  UNION ALL
  SELECT base_name || '-apimart' FROM keep_base
)
-- Step 1: delete stale abilities tagged 'apimart'.
DELETE FROM abilities
WHERE tag = 'apimart'
  AND model NOT IN (SELECT model_name FROM keep_names);

-- Step 2: soft-delete stale APIMart-owned models. We scope by vendor_id to
-- avoid touching models of other vendors that happen to share a real id
-- (e.g. `kling-v3` is also owned by 云雾 AI; that row stays intact).
WITH keep_base(base_name) AS (VALUES
  ('gemini-2.5-pro'),
  ('gpt-image-2'),
  ('gemini-2.5-flash-image-preview'),
  ('gemini-3-pro-image-preview'),
  ('gemini-3.1-flash-image-preview'),
  ('veo3.1-fast'),
  ('kling-v3'),
  ('doubao-seedance-2.0'),
  ('doubao-seedance-2.0-fast')
),
keep_names AS (
  SELECT base_name AS model_name FROM keep_base
  UNION ALL
  SELECT base_name || '-apimart' FROM keep_base
),
apimart_vendor AS (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
)
UPDATE models
SET deleted_at   = NOW(),
    status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE vendor_id = (SELECT id FROM apimart_vendor)
  AND deleted_at IS NULL
  AND model_name NOT IN (SELECT model_name FROM keep_names);

-- Step 3: prune options.ModelPrice of every stale key. ModelPrice is a
-- dict keyed by request model name — remove every key whose target is NOT
-- in the KEEP set AND is associated with APIMart (to avoid dropping keys
-- owned by other vendors that share a real id).
--
-- We identify "apimart-owned keys to drop" as:
--   * all keys ending in '-apimart' that are not in keep_names
--   * real-id keys that APIMart seeded but do not overlap with other
--     vendors' models — to be safe we ONLY drop the -apimart-suffixed
--     keys here. Real-id keys like 'sora-2' (seeded only by this patch's
--     earlier version) stay; they are harmless since no model/ability
--     references them after step 1 + 2, and an operator can override via
--     the admin UI.
--
-- In practice this removes the 70 suffixed keys that the earlier 008 wrote.

UPDATE options AS o
SET value = (o.value::jsonb - COALESCE(stale.keys, ARRAY[]::text[]))::text
FROM (
  SELECT key, ARRAY_AGG(k) AS keys
  FROM options,
       LATERAL jsonb_object_keys(value::jsonb) AS k
  WHERE key IN ('ModelPrice', 'ModelRatio', 'CompletionRatio', 'CacheRatio')
    AND k LIKE '%-apimart'
    AND k NOT IN (
      'gemini-2.5-pro-apimart',
      'gpt-image-2-apimart',
      'gemini-2.5-flash-image-preview-apimart',
      'gemini-3-pro-image-preview-apimart',
      'gemini-3.1-flash-image-preview-apimart',
      'veo3.1-fast-apimart',
      'kling-v3-apimart',
      'doubao-seedance-2.0-apimart',
      'doubao-seedance-2.0-fast-apimart'
    )
  GROUP BY key
) AS stale
WHERE o.key = stale.key;

COMMIT;
