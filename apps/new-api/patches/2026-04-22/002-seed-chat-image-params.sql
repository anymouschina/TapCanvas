-- 002-seed-chat-image-params.sql
-- Purpose: seed kind, capabilities, params_def for chat and image models.
-- Scope: PostgreSQL only, data-only, idempotent (UPDATE … WHERE model_name = …).

BEGIN;

-- ── chat models ──────────────────────────────────────────────────────────────

-- gpt-5.4: OpenAI chat + vision
UPDATE models SET
  kind         = 'chat',
  capabilities = '["vision","function_calling","streaming"]',
  params_def   = $json$[
    {"key":"temperature","type":"float","label":"温度","min":0,"max":2,"step":0.1,"default":1},
    {"key":"max_tokens","type":"integer","label":"最大输出 Token","min":1,"max":128000},
    {"key":"top_p","type":"float","label":"Top P","min":0,"max":1,"step":0.05,"default":1},
    {"key":"frequency_penalty","type":"float","label":"频率惩罚","min":-2,"max":2,"step":0.1,"default":0},
    {"key":"presence_penalty","type":"float","label":"存在惩罚","min":-2,"max":2,"step":0.1,"default":0},
    {"key":"image_detail","type":"enum","label":"图片精度","scope":"per_image","default":"auto",
     "options":[{"value":"auto","label":"自动"},{"value":"high","label":"高精度"},{"value":"low","label":"低精度"}]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-5.4' AND deleted_at IS NULL;

-- gemini-3-flash-preview: Gemini chat + vision + top_k
UPDATE models SET
  kind         = 'chat',
  capabilities = '["vision","function_calling","streaming"]',
  params_def   = $json$[
    {"key":"temperature","type":"float","label":"温度","min":0,"max":2,"step":0.1,"default":1},
    {"key":"max_tokens","type":"integer","label":"最大输出 Token","min":1,"max":65536},
    {"key":"top_p","type":"float","label":"Top P","min":0,"max":1,"step":0.05,"default":0.95},
    {"key":"top_k","type":"integer","label":"Top K","min":1,"max":40,"default":40},
    {"key":"image_detail","type":"enum","label":"图片精度","scope":"per_image","default":"auto",
     "options":[{"value":"auto","label":"自动"},{"value":"high","label":"高精度"},{"value":"low","label":"低精度"}]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gemini-3-flash-preview' AND deleted_at IS NULL;

-- gemini-3.1-pro-preview: same as gemini-3-flash-preview
UPDATE models SET
  kind         = 'chat',
  capabilities = '["vision","function_calling","streaming"]',
  params_def   = $json$[
    {"key":"temperature","type":"float","label":"温度","min":0,"max":2,"step":0.1,"default":1},
    {"key":"max_tokens","type":"integer","label":"最大输出 Token","min":1,"max":65536},
    {"key":"top_p","type":"float","label":"Top P","min":0,"max":1,"step":0.05,"default":0.95},
    {"key":"top_k","type":"integer","label":"Top K","min":1,"max":40,"default":40},
    {"key":"image_detail","type":"enum","label":"图片精度","scope":"per_image","default":"auto",
     "options":[{"value":"auto","label":"自动"},{"value":"high","label":"高精度"},{"value":"low","label":"低精度"}]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gemini-3.1-pro-preview' AND deleted_at IS NULL;

-- deepseek-v3.2: text only
UPDATE models SET
  kind         = 'chat',
  capabilities = '["function_calling","streaming"]',
  params_def   = $json$[
    {"key":"temperature","type":"float","label":"温度","min":0,"max":1.5,"step":0.1,"default":1},
    {"key":"max_tokens","type":"integer","label":"最大输出 Token","min":1,"max":65536},
    {"key":"top_p","type":"float","label":"Top P","min":0,"max":1,"step":0.05,"default":1}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'deepseek-v3.2' AND deleted_at IS NULL;

-- ── image models ─────────────────────────────────────────────────────────────

-- gpt-image-2: OpenAI image generation
UPDATE models SET
  kind         = 'image',
  capabilities = '[]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"尺寸","default":"1024x1024",
     "options":[
       {"value":"1024x1024","label":"1024×1024 (1:1)"},
       {"value":"1536x1024","label":"1536×1024 (3:2 横)"},
       {"value":"1024x1536","label":"1024×1536 (2:3 竖)"},
       {"value":"auto","label":"自动"}
     ]},
    {"key":"quality","type":"enum","label":"质量","default":"auto",
     "options":[
       {"value":"auto","label":"自动"},{"value":"high","label":"高"},
       {"value":"medium","label":"中"},{"value":"low","label":"低"}
     ]},
    {"key":"output_format","type":"enum","label":"输出格式","default":"png",
     "options":[{"value":"png","label":"PNG"},{"value":"jpeg","label":"JPEG"},{"value":"webp","label":"WebP"}]},
    {"key":"n","type":"integer","label":"生成数量","min":1,"max":10,"default":1}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-image-2' AND deleted_at IS NULL;

-- nano-banana-fast: Gemini image generation (aspect ratio + resolution tier)
UPDATE models SET
  kind         = 'image',
  capabilities = '[]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},{"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},{"value":"4:3","label":"4:3"},
       {"value":"3:4","label":"3:4"},{"value":"3:2","label":"3:2"},{"value":"2:3","label":"2:3"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"512","label":"512px"},{"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},{"value":"4K","label":"4K"}
     ]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'nano-banana-fast' AND deleted_at IS NULL;

-- nano-banana-pro: same params as nano-banana-fast
UPDATE models SET
  kind         = 'image',
  capabilities = '[]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},{"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},{"value":"4:3","label":"4:3"},
       {"value":"3:4","label":"3:4"},{"value":"3:2","label":"3:2"},{"value":"2:3","label":"2:3"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"512","label":"512px"},{"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},{"value":"4K","label":"4K"}
     ]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'nano-banana-pro' AND deleted_at IS NULL;

-- nanobanana2: same params as nano-banana-fast
UPDATE models SET
  kind         = 'image',
  capabilities = '[]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},{"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},{"value":"4:3","label":"4:3"},
       {"value":"3:4","label":"3:4"},{"value":"3:2","label":"3:2"},{"value":"2:3","label":"2:3"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"1K",
     "options":[
       {"value":"512","label":"512px"},{"value":"1K","label":"1K"},
       {"value":"2K","label":"2K"},{"value":"4K","label":"4K"}
     ]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'nanobanana2' AND deleted_at IS NULL;

-- doubao-seedream-5-0-260128: ByteDance image generation
UPDATE models SET
  kind         = 'image',
  capabilities = '[]',
  params_def   = $json$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},{"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},{"value":"4:3","label":"4:3"},
       {"value":"3:4","label":"3:4"},{"value":"3:2","label":"3:2"},
       {"value":"2:3","label":"2:3"},{"value":"21:9","label":"21:9 超宽"}
     ]},
    {"key":"n","type":"integer","label":"生成数量","min":1,"max":10,"default":1}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seedream-5-0-260128' AND deleted_at IS NULL;

COMMIT;
