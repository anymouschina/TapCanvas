-- 007-seed-wuyinkeji-extra-params.sql
-- Purpose: seed kind, capabilities, params_def for the 5 additional wuyinkeji
--          models so GET /api/models/list exposes them to external callers.
-- Aspect ratios / resolutions reflect wuyinkeji's actual accepted values per
-- its per-model doc pages (/doc/54, /55, /65, /48, /49).
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- nano-banana-fast-suchuang: NanoBanana (wuyinkeji). Upstream fields: prompt, imageSize, aspectRatio, urls.
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
    {"key":"imageSize","type":"enum","label":"分辨率","default":"1K",
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

-- nano-banana-pro-suchuang: NanoBanana-pro. Upstream fields: prompt, size, aspectRatio, urls.
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
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，图生图参考图 URL 列表"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'nano-banana-pro-suchuang' AND deleted_at IS NULL;

-- nanobanana2-suchuang: NanoBanana2. Upstream fields: prompt, size, aspectRatio, urls.
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
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，图生图参考图 URL 列表"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'nanobanana2-suchuang' AND deleted_at IS NULL;

-- veo3.1-fast-suchuang: veo3.1_fast. Upstream fields: prompt, firstFrameUrl, lastFrameUrl, urls, aspectRatio, size.
-- Note: wuyinkeji's `size` is RESOLUTION; `aspectRatio` is aspect. We map our
-- params_def `size` key → aspect ratio (hono-api convention), `resolution` key → upstream size.
UPDATE models SET
  kind         = 'video',
  capabilities = '["reference_images","first_last_frame"]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
       {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[
       {"value":"720p","label":"720p"},
       {"value":"1080p","label":"1080p"},
       {"value":"4K","label":"4K"}
     ]},
    {"key":"firstFrameUrl","type":"string","label":"首帧图 URL","scope":"per_request",
     "description":"可选，图生视频首帧"},
    {"key":"lastFrameUrl","type":"string","label":"尾帧图 URL","scope":"per_request",
     "description":"可选，图生视频尾帧"},
    {"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request",
     "description":"可选，最多 3 张参考图"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'veo3.1-fast-suchuang' AND deleted_at IS NULL;

-- veo3.1-pro-suchuang: veo3.1_pro. Upstream fields: prompt, firstFrameUrl, lastFrameUrl, aspectRatio, size.
UPDATE models SET
  kind         = 'video',
  capabilities = '["first_last_frame"]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
       {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[
       {"value":"720p","label":"720p"},
       {"value":"1080p","label":"1080p"},
       {"value":"4K","label":"4K"}
     ]},
    {"key":"firstFrameUrl","type":"string","label":"首帧图 URL","scope":"per_request",
     "description":"可选，图生视频首帧"},
    {"key":"lastFrameUrl","type":"string","label":"尾帧图 URL","scope":"per_request",
     "description":"可选，图生视频尾帧"}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'veo3.1-pro-suchuang' AND deleted_at IS NULL;

COMMIT;
