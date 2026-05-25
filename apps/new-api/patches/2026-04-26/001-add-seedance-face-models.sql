-- 001-add-seedance-face-models.sql
-- Purpose: enable doubao-seedance-2.0-face / doubao-seedance-2.0-fast-face
--          on the APIMart channel (id=9) and add ModelPrice entries.
--          Mirrors the [tapcanvas_new_api] section of
--          apps/hono-api/patches/2026-04-26-seedance-face-models.sql.
--
-- Scope: PostgreSQL only, data-only, idempotent.
-- Order: INSERT face rows first (so they exist), THEN UPDATE params_def.
--        Reversing this order would leave params_def NULL on fresh databases
--        because the UPDATE would match zero rows before the INSERT runs.

-- 1. Seed face models if not yet present (vendor = APIMart AI).

WITH v AS (SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1),
face_models(model_name, description, kind) AS (VALUES
  ('doubao-seedance-2.0-face',          'APIMart upstream doubao-seedance-2.0-face',          'video'),
  ('doubao-seedance-2.0-face-apimart',  'APIMart vendor-suffixed alias for upstream doubao-seedance-2.0-face',  'video'),
  ('doubao-seedance-2.0-fast-face',     'APIMart upstream doubao-seedance-2.0-fast-face',     'video'),
  ('doubao-seedance-2.0-fast-face-apimart', 'APIMart vendor-suffixed alias for upstream doubao-seedance-2.0-fast-face', 'video')
)
INSERT INTO models (model_name, description, icon, tags, vendor_id, endpoints, kind, status, sync_official, created_time, updated_time, name_rule)
SELECT f.model_name, f.description, NULL, NULL, v.id, NULL, f.kind, 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM face_models AS f
CROSS JOIN v
WHERE NOT EXISTS (
  SELECT 1 FROM models AS m WHERE m.model_name = f.model_name AND m.deleted_at IS NULL
);

-- 2. Enable face models (clear soft-delete + set status=1) and seed params_def.

UPDATE models SET
  status = 1,
  deleted_at = NULL,
  params_def = '[
    {"key":"duration","type":"enum","label":"时长","default":5,
     "options":[
       {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
       {"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},
       {"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},
       {"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}
     ]},
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"21:9","label":"21:9"},{"value":"16:9","label":"16:9"},
       {"value":"4:3","label":"4:3"},{"value":"1:1","label":"1:1"},
       {"value":"3:4","label":"3:4"},{"value":"9:16","label":"9:16"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]}
  ]',
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('doubao-seedance-2.0-face', 'doubao-seedance-2.0-face-apimart');

UPDATE models SET
  status = 1,
  deleted_at = NULL,
  params_def = '[
    {"key":"duration","type":"enum","label":"时长","default":5,
     "options":[
       {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
       {"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},
       {"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},
       {"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}
     ]},
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"21:9","label":"21:9"},{"value":"16:9","label":"16:9"},
       {"value":"4:3","label":"4:3"},{"value":"1:1","label":"1:1"},
       {"value":"3:4","label":"3:4"},{"value":"9:16","label":"9:16"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
  ]',
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('doubao-seedance-2.0-fast-face', 'doubao-seedance-2.0-fast-face-apimart');

-- 3. Add ModelPrice entries for face models.

UPDATE options
SET value = (value::jsonb || '{"doubao-seedance-2.0-face":15,"doubao-seedance-2.0-face-apimart":15,"doubao-seedance-2.0-fast-face":12,"doubao-seedance-2.0-fast-face-apimart":12}'::jsonb)::text
WHERE key = 'ModelPrice';

-- 4. Add face models to the apimart channel (id=9) and seed abilities.

UPDATE channels
SET models = models || ',doubao-seedance-2.0-face,doubao-seedance-2.0-fast-face,doubao-seedance-2.0-face-apimart,doubao-seedance-2.0-fast-face-apimart'
WHERE id = 9
  AND models NOT LIKE '%doubao-seedance-2.0-face%';

-- Update model_mapping to include face alias → canonical mappings.
UPDATE channels
SET model_mapping = (model_mapping::jsonb || '{"doubao-seedance-2.0-face-apimart":"doubao-seedance-2.0-face","doubao-seedance-2.0-fast-face-apimart":"doubao-seedance-2.0-fast-face"}'::jsonb)::text
WHERE id = 9;

-- Seed abilities for both default and auto groups.
WITH face_models(model) AS (VALUES
  ('doubao-seedance-2.0-face'),
  ('doubao-seedance-2.0-fast-face'),
  ('doubao-seedance-2.0-face-apimart'),
  ('doubao-seedance-2.0-fast-face-apimart')
),
ability_matrix AS (
  SELECT g.ability_group, m.model
  FROM face_models AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, 9, true, 0, 0, 'apimart'
FROM ability_matrix AS am
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, tag = EXCLUDED.tag;
