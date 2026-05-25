-- 002-add-kling-motion-control.sql
-- Purpose: register kling-v2-6-motion-control AND kling-v3-motion-control
-- (APIMart) into new-api. v2.6 and v3 are TWO different SKUs with different
-- per-second pricing — they MUST NOT share a canonical model.
--   1. Insert 4 rows into models:
--      - kling-v2-6-motion-control (+ -apimart alias)
--      - kling-v3-motion-control   (+ -apimart alias)
--   2. Set kind / capabilities / params_def. Note: motion-control has NO
--      resolution param upstream — it has `mode` (std|pro). We borrow the
--      `resolution` enum slot for std/pro so hono-api paramsToVideoOptions
--      and the frontend (data.videoResolution → mode) keep working without
--      code changes. spec_key follows `video:{std|pro}:{N}s`, matching
--      linearVideoPricingRules in model/pricing.go.
--   3. Register all four names on the APIMart channel + model_mapping.
--   4. Seed abilities for default + auto groups.
--   5. Set ModelPrice flat fallback per SKU (std × 5s in CNY).
--
-- Per-spec pricing (mode × duration) is computed by linearVideoPricingRules
-- in model/pricing.go; no SQL needed for that part.
--
-- Duration options: 3–15s, aligned with kling-v3 / kling-v3-omni.
-- motion-control upstream allows 3–10s (image-anchored) and 3–30s
-- (video-anchored); 16–30s left out for now — frontend clamps if needed.
--
-- Retail price reference (USD/s → × 7.3 → CNY/s):
--   v2.6 std=$0.0714 pro=$0.1143   → 0.5212 / 0.8344
--   v3   std=$0.1286 pro=$0.1714   → 0.9388 / 1.2512
--
-- Idempotent: INSERT ON CONFLICT DO NOTHING; UPDATE guarded by NOT LIKE.
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
  ('kling-v2-6-motion-control',         'APIMart upstream kling-v2-6-motion-control'),
  ('kling-v2-6-motion-control-apimart', 'APIMart vendor-suffixed alias for upstream kling-v2-6-motion-control'),
  ('kling-v3-motion-control',           'APIMart upstream kling-v3-motion-control'),
  ('kling-v3-motion-control-apimart',   'APIMart vendor-suffixed alias for upstream kling-v3-motion-control')
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
    capabilities = '["reference_images"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":5,
       "options":[
         {"value":3,"label":"3s"},{"value":4,"label":"4s"},{"value":5,"label":"5s"},
         {"value":6,"label":"6s"},{"value":7,"label":"7s"},{"value":8,"label":"8s"},
         {"value":9,"label":"9s"},{"value":10,"label":"10s"},{"value":11,"label":"11s"},
         {"value":12,"label":"12s"},{"value":13,"label":"13s"},{"value":14,"label":"14s"},
         {"value":15,"label":"15s"}
       ]},
      {"key":"resolution","type":"enum","label":"质量","default":"std",
       "options":[
         {"value":"std","label":"标准模式"},
         {"value":"pro","label":"专家模式"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
        'kling-v2-6-motion-control', 'kling-v2-6-motion-control-apimart',
        'kling-v3-motion-control',   'kling-v3-motion-control-apimart'
      )
  AND deleted_at IS NULL;

-- ── Step 3: add to APIMart channel ──────────────────────────────────────────
-- v2.6 and v3 are handled in two independent UPDATEs so a prior patch run
-- that already registered v2.6 doesn't block v3 (AND-joined LIKE guards
-- would short-circuit the whole row).

UPDATE channels
SET models        = models || ',kling-v2-6-motion-control,kling-v2-6-motion-control-apimart',
    model_mapping = (
      model_mapping::jsonb
      || '{"kling-v2-6-motion-control-apimart":"kling-v2-6-motion-control"}'::jsonb
    )::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default'
  AND models NOT LIKE '%kling-v2-6-motion-control%';

UPDATE channels
SET models        = models || ',kling-v3-motion-control,kling-v3-motion-control-apimart',
    model_mapping = (
      model_mapping::jsonb
      || '{"kling-v3-motion-control-apimart":"kling-v3-motion-control"}'::jsonb
    )::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default'
  AND models NOT LIKE '%kling-v3-motion-control%';

-- ── Step 4: seed abilities ───────────────────────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model_name, c.id, true, 0, 0, 'apimart'
FROM (VALUES
  ('kling-v2-6-motion-control'),
  ('kling-v2-6-motion-control-apimart'),
  ('kling-v3-motion-control'),
  ('kling-v3-motion-control-apimart')
) AS m(model_name)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

-- ── Step 5: model_price flat fallback ────────────────────────────────────────
-- std × 5s in CNY (rounded to 2 decimals):
--   v2.6 std × 5s = 0.5212 × 5 = 2.606 → 2.61
--   v3   std × 5s = 0.9388 × 5 = 4.694 → 4.69

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"kling-v2-6-motion-control": 2.61, "kling-v2-6-motion-control-apimart": 2.61, "kling-v3-motion-control": 4.69, "kling-v3-motion-control-apimart": 4.69}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo '----- kling motion-control models after patch -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params_def
FROM models
WHERE model_name LIKE 'kling-%motion-control%'
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
