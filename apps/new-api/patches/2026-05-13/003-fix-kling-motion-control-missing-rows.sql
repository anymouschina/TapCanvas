-- 003-fix-kling-motion-control-missing-rows.sql
-- Purpose: backfill rows that an earlier revision of
-- 2026-05-13/002-add-kling-motion-control.sql failed to register.
--
-- Background:
--   The first revision of 002 only registered `kling-v2-6-motion-control`
--   (a single canonical row). After that revision ran, the schema_migrations
--   table recorded the filename as applied. A subsequent rewrite of 002 that
--   added the v3 SKU and the `-apimart` aliases never re-ran — the patch
--   runner (apps/hono-api/docker-compose.yml:368-399) skips files already
--   present in schema_migrations regardless of content changes.
--
-- This patch is the catch-up: idempotently ensure all 4 model rows exist,
-- all 4 have correct params_def/capabilities, all 4 are wired into the
-- APIMart channel + model_mapping + abilities, and the ModelPrice fallback
-- covers both SKUs.
--
-- Re-runnable: every statement is guarded so applying it on a fully-correct
-- database is a no-op.
--
-- Scope: PostgreSQL, data-only.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: ensure all 4 model rows exist ────────────────────────────────────

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

-- ── Step 2: re-assert params_def on all 4 rows (in case the first 002 had
--           an older schema or the row predated the params_def column update) ─

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

-- ── Step 3: register on APIMart channel ─────────────────────────────────────
-- The current environment may already have some of these names in
-- channels.models (e.g. v2.6 base from the first 002 run). We can't just
-- `models || ',...'` because that would duplicate names already present.
-- Instead, dedupe the comma-separated list via array_distinct.

UPDATE channels
SET models = (
      SELECT string_agg(name, ',')
      FROM (
        SELECT DISTINCT trim(name) AS name
        FROM unnest(string_to_array(
          models
          || ',kling-v2-6-motion-control,kling-v2-6-motion-control-apimart'
          || ',kling-v3-motion-control,kling-v3-motion-control-apimart',
          ','
        )) AS name
        WHERE trim(name) <> ''
      ) AS uniq
    ),
    model_mapping = (
      model_mapping::jsonb
      || '{"kling-v2-6-motion-control-apimart":"kling-v2-6-motion-control"}'::jsonb
      || '{"kling-v3-motion-control-apimart":"kling-v3-motion-control"}'::jsonb
    )::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default';

-- ── Step 4: ensure abilities exist for all 4 names × {default, auto} ─────────

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

-- ── Step 5: ensure ModelPrice fallback covers all 4 names ───────────────────

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"kling-v2-6-motion-control": 2.61, "kling-v2-6-motion-control-apimart": 2.61, "kling-v3-motion-control": 4.69, "kling-v3-motion-control-apimart": 4.69}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo '----- kling motion-control rows after backfill -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params_def
FROM models
WHERE model_name LIKE 'kling-%motion-control%'
  AND deleted_at IS NULL
ORDER BY model_name;

\echo '----- channels.models for apimart (motion-control slice) -----'
SELECT regexp_replace(models, '.*?(kling-[^,]*motion-control[^,]*)', '\1', 'g') AS motion_control_models
FROM channels
WHERE name = 'apimart' AND type = 59 AND "group" = 'default'
LIMIT 1;

COMMIT;
