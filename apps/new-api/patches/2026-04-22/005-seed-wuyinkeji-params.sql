-- 005-seed-wuyinkeji-params.sql
-- Purpose: seed kind, capabilities, params_def for wuyinkeji-backed models so that
--          GET /api/models/list exposes them to external callers.
-- Background: wuyinkeji gpt-image-2 accepts ASPECT RATIO (auto / 16:9 / 9:16 / 1:1
--             / 3:2 / 2:3) rather than pixel sizes — differs from the OpenAI-style
--             gpt-image-2 via comfly. Keeping params scoped to the model name.
-- Scope: PostgreSQL only, data-only, idempotent (UPDATE WHERE model_name = …).

BEGIN;

-- gpt-image-2-suchuang: Wuyinkeji async image generation (/api/async/image_gpt)
UPDATE models SET
  kind         = 'image',
  capabilities = '["reference_images"]',
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
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，用于图生图的参考图 URL 列表"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-image-2-suchuang' AND deleted_at IS NULL;

COMMIT;
