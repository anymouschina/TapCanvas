-- 001-gpt-image-2-add-image-size-param.sql
-- Purpose: add image_size (resolution) param to all gpt-image-2 variants so the
--          image node exposes a resolution selector in the UI.
--          Covers gpt-image-2, gpt-image-2-apimart, gpt-image-2-suchuang.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

UPDATE models SET
  params_def   = $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"auto",
     "options":[
       {"value":"auto","label":"自动"},
       {"value":"1:1","label":"1:1"},
       {"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},
       {"value":"3:2","label":"3:2 横"},
       {"value":"2:3","label":"2:3 竖"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},
       {"value":"4K","label":"4K"}
     ]},
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，用于图生图的参考图 URL 列表"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('gpt-image-2', 'gpt-image-2-apimart', 'gpt-image-2-suchuang')
  AND deleted_at IS NULL;

COMMIT;
