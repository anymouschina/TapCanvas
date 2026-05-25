-- 001-add-omni-flash-ext.sql
-- Purpose: add omni-flash-ext (APIMart Gemini v4.6.4 extended video) to new-api.
--   1. Insert omni-flash-ext + omni-flash-ext-apimart into models.
--   2. Set kind=video / params_def (duration 4/6/8/10s, size 16:9/9:16, resolution 720P/1080P/4K).
--   3. Add both names to the APIMart channel models list + model_mapping.
--   4. Seed abilities (default + auto groups).
--   5. Set model_price flat fallback (1080P × 6s = ¥1.86).
--
-- Pricing: official USD = APIMart current / 0.8; our price = official × 1.2 × 7.3 CNY.
-- Per-spec pricing (fixed, non-linear) is handled by fixedVideoPricingSpecs in model/pricing.go.
--
-- Idempotent: INSERT ON CONFLICT DO NOTHING; UPDATE guarded by NOT LIKE check.
-- Scope: PostgreSQL, data-only.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: insert models ────────────────────────────────────────────────────

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT m.model_name, m.description, NULL, NULL, v.id, NULL, 'video', 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM (VALUES
  ('omni-flash-ext',         'APIMart Omni-Flash-Ext — Gemini v4.6.4 extended video generation'),
  ('omni-flash-ext-apimart', 'APIMart vendor-suffixed alias for omni-flash-ext')
) AS m(model_name, description)
CROSS JOIN (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models AS existing
  WHERE existing.model_name = m.model_name AND existing.deleted_at IS NULL
);

-- ── Step 2: set params_def ───────────────────────────────────────────────────
-- duration: 4/6/8/10s (APIMart docs: only 4|6|8|10 are valid).
-- resolution: 720P / 1080P / 4K.
-- size: aspect ratio (16:9 landscape / 9:16 portrait).
-- Default: 6s, 1080P, 16:9.

UPDATE models
SET kind         = 'video',
    capabilities = '["reference_images"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":6,
       "options":[
         {"value":4,"label":"4s"},{"value":6,"label":"6s"},
         {"value":8,"label":"8s"},{"value":10,"label":"10s"}
       ]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"1080P",
       "options":[
         {"value":"720P","label":"720P"},
         {"value":"1080P","label":"1080P"},
         {"value":"4K","label":"4K"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('omni-flash-ext', 'omni-flash-ext-apimart')
  AND deleted_at IS NULL;

-- ── Step 3: add to APIMart channel ──────────────────────────────────────────

UPDATE channels
SET models        = models || ',omni-flash-ext,omni-flash-ext-apimart',
    model_mapping = (model_mapping::jsonb || '{"omni-flash-ext-apimart":"omni-flash-ext"}'::jsonb)::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default'
  AND models NOT LIKE '%omni-flash-ext%';

-- ── Step 4: seed abilities ───────────────────────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model_name, c.id, true, 0, 0, 'apimart'
FROM (VALUES
  ('omni-flash-ext'),
  ('omni-flash-ext-apimart')
) AS m(model_name)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

-- ── Step 5: model_price flat fallback ────────────────────────────────────────
-- Default resolution=1080P, duration=6s → official $0.2125 × 1.2 × 7.3 = ¥1.86

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"omni-flash-ext": 1.86, "omni-flash-ext-apimart": 1.86}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo '----- omni-flash-ext models after patch -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params_def
FROM models
WHERE model_name LIKE 'omni-flash-ext%'
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
