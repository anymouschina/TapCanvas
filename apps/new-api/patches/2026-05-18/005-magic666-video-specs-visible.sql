-- 005-magic666-video-specs-visible.sql
-- Purpose:
--   Ensure Magic666 video models are visible to TapCanvas video nodes.
--
-- Background:
--   hono-api fetches new-api models with require_video_spec=true. new-api then
--   filters out video models whose params_def has no non-empty resolution enum.
--   Patch 004 originally seeded Magic666 video params with duration + size only,
--   so already-patched environments can still hide these models from
--   /new-api-models?kind=video.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

WITH magic666_video_params(params_def) AS (
  VALUES ($json$[
    {"key":"duration","type":"enum","label":"时长","default":10,
     "options":[{"value":10,"label":"10s"},{"value":15,"label":"15s"}]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"720p","label":"720p"}]},
    {"key":"size","type":"enum","label":"尺寸","default":"720x1280",
     "options":[
       {"value":"720x1280","label":"竖屏","aspectRatio":"9:16","orientation":"portrait"},
       {"value":"1280x720","label":"横屏","aspectRatio":"16:9","orientation":"landscape"}
     ]}
  ]$json$)
)
UPDATE models m
SET kind         = 'video',
    status       = 1,
    endpoints    = '["openai"]',
    params_def   = p.params_def,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM magic666_video_params p
WHERE m.model_name IN ('veo_3_1-fast', 'veo_3_1-4K', 'veo_3_1', 'veo3.1-pro', 'sora-2', 'sora-2-oai')
  AND m.deleted_at IS NULL;

UPDATE models
SET params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":4,
       "options":[{"value":4,"label":"4s"},{"value":8,"label":"8s"},{"value":12,"label":"12s"}]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
       "options":[{"value":"720p","label":"720p"}]},
      {"key":"size","type":"enum","label":"尺寸","default":"720x1280",
       "options":[
         {"value":"720x1280","label":"竖屏","aspectRatio":"9:16","orientation":"portrait"},
         {"value":"1280x720","label":"横屏","aspectRatio":"16:9","orientation":"landscape"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'sora-2-oai'
  AND deleted_at IS NULL;

-- Make the flat fallback prices explicit for every newly exposed SKU.
-- Sora prices are the user-requested per-call prices. Veo prices reuse the
-- existing Veo family prices from earlier patches.
INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"sora-2": 0.2, "sora-2-oai": 0.5, "veo_3_1-fast": 1.3, "veo_3_1-4K": 5.5, "veo_3_1": 5.5, "veo3.1-pro": 5.5}'::jsonb::text
)
ON CONFLICT (key) DO UPDATE
SET value = (COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb) || EXCLUDED.value::jsonb)::text;

\echo '----- Magic666 visible video specs -----'
SELECT model_name, kind, status, params_def
FROM models
WHERE model_name IN ('veo_3_1-fast', 'veo_3_1-4K', 'veo_3_1', 'veo3.1-pro', 'sora-2', 'sora-2-oai')
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
