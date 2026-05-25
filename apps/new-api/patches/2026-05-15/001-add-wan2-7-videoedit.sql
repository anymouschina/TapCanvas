-- 001-add-wan2-7-videoedit.sql
-- Purpose: add wan2.7-videoedit model (APIMart) to new-api.
--   1. Insert wan2.7-videoedit + wan2.7-videoedit-apimart into models.
--   2. Set kind=video / params_def (duration 2-10s, size, resolution 720P/1080P default).
--   3. Add both forms to the APIMart channel models list + model_mapping.
--   4. Seed abilities (default + auto groups).
--   5. Set model_price flat fallback (1080P × 5s = 1.2001 × 5 ≈ 6.0 CNY).
--
-- Pricing: $0.083/s (720P) and $0.137/s (1080P) official × 7.3 × 1.2.
-- Per-spec pricing by duration is handled by linearVideoPricingRules in model/pricing.go.
-- duration=0 ("keep original length") is intentionally excluded from options because
-- billing cannot compute cost for an unknown duration at submission time.
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
  ('wan2.7-videoedit',         'APIMart wan2.7 video editing model'),
  ('wan2.7-videoedit-apimart', 'APIMart vendor-suffixed alias for wan2.7-videoedit')
) AS m(model_name, description)
CROSS JOIN (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models AS existing
  WHERE existing.model_name = m.model_name AND existing.deleted_at IS NULL
);

-- ── Step 2: set params_def ───────────────────────────────────────────────────
-- duration=0 excluded: billing cannot compute cost for unknown duration at submit time.
-- Default resolution is 1080P per APIMart docs.

UPDATE models
SET kind         = 'video',
    capabilities = '["reference_video","reference_images"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":5,
       "options":[
         {"value":2,"label":"2s"},{"value":3,"label":"3s"},{"value":4,"label":"4s"},
         {"value":5,"label":"5s"},{"value":6,"label":"6s"},{"value":7,"label":"7s"},
         {"value":8,"label":"8s"},{"value":9,"label":"9s"},{"value":10,"label":"10s"}
       ]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},
         {"value":"1:1","label":"1:1","aspectRatio":"1:1"},
         {"value":"4:3","label":"4:3","aspectRatio":"4:3"},
         {"value":"3:4","label":"3:4","aspectRatio":"3:4"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"1080P",
       "options":[
         {"value":"720P","label":"720P"},
         {"value":"1080P","label":"1080P"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('wan2.7-videoedit', 'wan2.7-videoedit-apimart')
  AND deleted_at IS NULL;

-- ── Step 3: add to APIMart channel ──────────────────────────────────────────

UPDATE channels
SET models        = models || ',wan2.7-videoedit,wan2.7-videoedit-apimart',
    model_mapping = (model_mapping::jsonb || '{"wan2.7-videoedit-apimart":"wan2.7-videoedit"}'::jsonb)::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default'
  AND models NOT LIKE '%wan2.7-videoedit%';

-- ── Step 4: seed abilities ───────────────────────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model_name, c.id, true, 0, 0, 'apimart'
FROM (VALUES
  ('wan2.7-videoedit'),
  ('wan2.7-videoedit-apimart')
) AS m(model_name)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

-- ── Step 5: model_price flat fallback ────────────────────────────────────────
-- Default resolution=1080P, duration=5s → 1.2001 × 5 = 6.0005 CNY → 60 credits

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"wan2.7-videoedit": 6.0, "wan2.7-videoedit-apimart": 6.0}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo '----- wan2.7-videoedit models after patch -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params_def
FROM models
WHERE model_name LIKE 'wan2.7-videoedit%'
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
