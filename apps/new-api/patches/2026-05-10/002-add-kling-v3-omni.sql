-- 002-add-kling-v3-omni.sql
-- Purpose: add kling-v3-omni model (APIMart) to new-api.
--   1. Insert kling-v3-omni + kling-v3-omni-apimart into models.
--   2. Set kind / capabilities / params_def (duration 3-15s, size, resolution 720p/1080p/4k).
--   3. Add both forms to the APIMart channel models list + model_mapping.
--   4. Seed abilities (default + auto groups).
--   5. Set model_price flat fallback in options (720p × 5s = 0.6132 × 5 ≈ 3.07 CNY).
--
-- Per-spec pricing (resolution × duration) is handled by linearVideoPricingRules
-- in model/pricing.go; no SQL needed for that part.
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
  ('kling-v3-omni',         'APIMart upstream kling-v3-omni'),
  ('kling-v3-omni-apimart', 'APIMart vendor-suffixed alias for upstream kling-v3-omni')
) AS m(model_name, description)
CROSS JOIN (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models AS existing
  WHERE existing.model_name = m.model_name AND existing.deleted_at IS NULL
);

-- ── Step 2: set params_def ───────────────────────────────────────────────────

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
WHERE model_name IN ('kling-v3-omni', 'kling-v3-omni-apimart')
  AND deleted_at IS NULL;

-- ── Step 3: add to APIMart channel ──────────────────────────────────────────

UPDATE channels
SET models        = models || ',kling-v3-omni,kling-v3-omni-apimart',
    model_mapping = (model_mapping::jsonb || '{"kling-v3-omni-apimart":"kling-v3-omni"}'::jsonb)::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default'
  AND models NOT LIKE '%kling-v3-omni%';

-- ── Step 4: seed abilities ───────────────────────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model_name, c.id, true, 0, 0, 'apimart'
FROM (VALUES
  ('kling-v3-omni'),
  ('kling-v3-omni-apimart')
) AS m(model_name)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

-- ── Step 5: model_price flat fallback ────────────────────────────────────────
-- 720p × 5s = 0.6132 × 5 = 3.07 CNY → 31 credits @ 10 credits/CNY

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"kling-v3-omni": 3.07, "kling-v3-omni-apimart": 3.07}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo '----- kling-v3-omni models after patch -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params_def
FROM models
WHERE model_name LIKE 'kling-v3-omni%'
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
