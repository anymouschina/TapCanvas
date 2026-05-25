-- 001-gemini-image-params.sql
-- Purpose: ensure canonical Gemini image models expose their real supported
--          aspect ratio (`size`) and resolution (`image_size`) controls through
--          GET /api/models/params.
--          APIMart routes now use canonical gemini-* image model keys, while
--          older params patches only covered nano-banana business aliases.
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

WITH param_defs(profile, params_def) AS (VALUES
  ('gemini_25_flash', $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},
       {"value":"2:3","label":"2:3"},
       {"value":"3:2","label":"3:2"},
       {"value":"3:4","label":"3:4"},
       {"value":"4:3","label":"4:3"},
       {"value":"4:5","label":"4:5"},
       {"value":"5:4","label":"5:4"},
       {"value":"9:16","label":"9:16"},
       {"value":"16:9","label":"16:9"},
       {"value":"21:9","label":"21:9"}
     ]},
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，图生图参考图 URL 列表"}
  ]$json$),
  ('gemini_3_pro', $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},
       {"value":"2:3","label":"2:3"},
       {"value":"3:2","label":"3:2"},
       {"value":"3:4","label":"3:4"},
       {"value":"4:3","label":"4:3"},
       {"value":"4:5","label":"4:5"},
       {"value":"5:4","label":"5:4"},
       {"value":"9:16","label":"9:16"},
       {"value":"16:9","label":"16:9"},
       {"value":"21:9","label":"21:9"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},
       {"value":"4K","label":"4K"}
     ]},
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，图生图参考图 URL 列表"}
  ]$json$),
  ('gemini_31_flash', $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},
       {"value":"1:4","label":"1:4"},
       {"value":"1:8","label":"1:8"},
       {"value":"2:3","label":"2:3"},
       {"value":"3:2","label":"3:2"},
       {"value":"3:4","label":"3:4"},
       {"value":"4:1","label":"4:1"},
       {"value":"4:3","label":"4:3"},
       {"value":"4:5","label":"4:5"},
       {"value":"5:4","label":"5:4"},
       {"value":"8:1","label":"8:1"},
       {"value":"9:16","label":"9:16"},
       {"value":"16:9","label":"16:9"},
       {"value":"21:9","label":"21:9"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"512","label":"512"},
       {"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},
       {"value":"4K","label":"4K"}
     ]},
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，图生图参考图 URL 列表"}
  ]$json$)
),
model_profiles(model_name, profile) AS (VALUES
  ('gemini-2.5-flash-image-preview', 'gemini_25_flash'),
  ('gemini-2.5-flash-image-preview-apimart', 'gemini_25_flash'),
  ('gemini-3-pro-image-preview', 'gemini_3_pro'),
  ('gemini-3-pro-image-preview-apimart', 'gemini_3_pro'),
  ('gemini-3.1-flash-image-preview', 'gemini_31_flash'),
  ('gemini-3.1-flash-image-preview-apimart', 'gemini_31_flash')
)
UPDATE models AS m
SET kind = 'image',
    capabilities = '["reference_images"]',
    params_def = param_defs.params_def,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM model_profiles
JOIN param_defs ON param_defs.profile = model_profiles.profile
WHERE m.model_name = model_profiles.model_name
  AND m.deleted_at IS NULL;

\echo
\echo '----- gemini image params after patch -----'
SELECT
  model_name,
  jsonb_path_query_array(params_def::jsonb, '$[*].key') AS param_keys,
  jsonb_path_query_array(params_def::jsonb, '$[*] ? (@.key == "size").options[*].value') AS size_values,
  jsonb_path_query_array(params_def::jsonb, '$[*] ? (@.key == "image_size").options[*].value') AS image_size_values
FROM models
WHERE model_name IN (
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image-preview-apimart',
  'gemini-3-pro-image-preview',
  'gemini-3-pro-image-preview-apimart',
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-image-preview-apimart'
)
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
