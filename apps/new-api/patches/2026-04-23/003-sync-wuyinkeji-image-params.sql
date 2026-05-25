-- 003-sync-wuyinkeji-image-params.sql
-- Purpose: normalize wuyinkeji image model params so canonical image models expose
--          a consistent `size` (aspect ratio) + `image_size` (resolution) contract
--          through GET /api/models/params.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- nano-banana-fast-suchuang: upstream uses imageSize + aspectRatio + urls.
-- Externally we still expose the canonical key `image_size`; the adaptor already
-- reads this key from request metadata and maps it to upstream imageSize.
UPDATE models SET
  kind         = 'image',
  capabilities = '["reference_images"]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},
       {"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},
       {"value":"4:3","label":"4:3"},
       {"value":"3:4","label":"3:4"},
       {"value":"3:2","label":"3:2"},
       {"value":"2:3","label":"2:3"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"512","label":"512px"},
       {"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},
       {"value":"4K","label":"4K"}
     ]},
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，图生图参考图 URL 列表"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'nano-banana-fast-suchuang' AND deleted_at IS NULL;

-- nano-banana-pro-suchuang: upstream uses size (resolution) + aspectRatio + urls.
UPDATE models SET
  kind         = 'image',
  capabilities = '["reference_images"]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},
       {"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},
       {"value":"4:3","label":"4:3"},
       {"value":"3:4","label":"3:4"},
       {"value":"3:2","label":"3:2"},
       {"value":"2:3","label":"2:3"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"512","label":"512px"},
       {"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},
       {"value":"4K","label":"4K"}
     ]},
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，图生图参考图 URL 列表"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'nano-banana-pro-suchuang' AND deleted_at IS NULL;

-- nanobanana2-suchuang: same upstream contract as nano-banana-pro-suchuang.
UPDATE models SET
  kind         = 'image',
  capabilities = '["reference_images"]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},
       {"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},
       {"value":"4:3","label":"4:3"},
       {"value":"3:4","label":"3:4"},
       {"value":"3:2","label":"3:2"},
       {"value":"2:3","label":"2:3"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"512","label":"512px"},
       {"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},
       {"value":"4K","label":"4K"}
     ]},
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，图生图参考图 URL 列表"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'nanobanana2-suchuang' AND deleted_at IS NULL;

COMMIT;
