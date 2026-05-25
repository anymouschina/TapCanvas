-- 004-add-kling-v3-apimart.sql
-- Purpose: register the APIMart-channel kling-v3 (non-omni, non-motion-control)
-- as a selectable model alongside the existing Yunwu kling-v3 (id=7).
--
-- Background:
--   - `kling-v3` (model_name) is already owned by id=7 / vendor_id=1 (Yunwu).
--   - The models.model_name column has a unique index (uk_model_name_delete_at),
--     so we cannot insert a second 'kling-v3' row.
--   - The APIMart entry uses model_name='kling-v3-apimart', with the canonical
--     name resolved at runtime via canonical_model.go (kling-v3-apimart → kling-v3)
--     and via channels.model_mapping below.
--
--   Pricing (pricing.go:linearVideoPricingRules) already covers 720p / 1080p /
--   720p+sound / 1080p+sound / 4k / 4k+sound for both 'kling-v3' and
--   'kling-v3-apimart' keys. The UI surfaces only 720p / 1080p / 4k via
--   params_def — the +sound variants are reserved for billing paths that
--   enable audio.
--
--   Upstream API: POST /v1/videos/generations
--   model='kling-v3' (we send the canonical name to APIMart, alias gets
--   mapped in channels.model_mapping). Required: prompt. Optional: mode
--   (std=720p / pro=1080p / 4k), duration (3-15s), aspect_ratio
--   (16:9 / 9:16 / 1:1), image_urls[1-2] (first / first+last).
--   Doc: https://docs.apimart.ai/cn/api-reference/videos/kling-v3/generation
--
-- Idempotent: re-runnable. Scope: PostgreSQL, data-only.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: insert APIMart model row ─────────────────────────────────────────

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT 'kling-v3-apimart',
       'APIMart upstream kling-v3',
       NULL, NULL, v.id, NULL, 'video', 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models
  WHERE model_name = 'kling-v3-apimart' AND deleted_at IS NULL
);

-- ── Step 2: params_def ───────────────────────────────────────────────────────
-- resolution values map to upstream mode: 720p=std, 1080p=pro, 4k=4k.
-- spec_key follows `video:{resolution}:{duration}s`, aligned with
-- pricing.go linearVideoPricingRules['kling-v3-apimart'].

UPDATE models
SET kind         = 'video',
    capabilities = '["reference_images","first_last_frame"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":5,
       "options":[
         {"value":3,"label":"3s"},{"value":4,"label":"4s"},{"value":5,"label":"5s"},
         {"value":6,"label":"6s"},{"value":7,"label":"7s"},{"value":8,"label":"8s"},
         {"value":9,"label":"9s"},{"value":10,"label":"10s"},{"value":11,"label":"11s"},
         {"value":12,"label":"12s"},{"value":13,"label":"13s"},{"value":14,"label":"14s"},
         {"value":15,"label":"15s"}
       ]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},
         {"value":"1:1","label":"1:1","aspectRatio":"1:1"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
       "options":[
         {"value":"720p","label":"720p"},
         {"value":"1080p","label":"1080p"},
         {"value":"4k","label":"4K"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'kling-v3-apimart'
  AND deleted_at IS NULL;

-- ── Step 3: register on APIMart channel ─────────────────────────────────────
-- model_mapping aliases the APIMart-suffixed name back to the canonical
-- 'kling-v3' that upstream actually accepts. Dedup the comma list so a
-- partial prior run doesn't double-append.

UPDATE channels
SET models = (
      SELECT string_agg(name, ',')
      FROM (
        SELECT DISTINCT trim(name) AS name
        FROM unnest(string_to_array(models || ',kling-v3-apimart', ',')) AS name
        WHERE trim(name) <> ''
      ) AS uniq
    ),
    model_mapping = (
      model_mapping::jsonb
      || '{"kling-v3-apimart":"kling-v3"}'::jsonb
    )::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default';

-- ── Step 4: seed abilities (default + auto) ─────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, 'kling-v3-apimart', c.id, true, 0, 0, 'apimart'
FROM (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

-- ── Step 5: model_price flat fallback ────────────────────────────────────────
-- 720p × 5s = 0.6132 × 5 = 3.07 CNY → 31 credits @ 10 credits/CNY.
-- Aligned with how kling-v3-omni's fallback was set (2026-05-10/002).

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"kling-v3-apimart": 3.07}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo '----- kling-v3 apimart row after patch -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params_def
FROM models
WHERE model_name = 'kling-v3-apimart' AND deleted_at IS NULL;

COMMIT;
