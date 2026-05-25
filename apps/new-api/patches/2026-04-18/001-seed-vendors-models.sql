-- 001-seed-vendors-models.sql
-- Purpose: seed or upsert vendor and model metadata into new-api.
-- Source: local tapcanvas_new_api canonical data as of 2026-04-18.
-- Scope: PostgreSQL only, data-only, idempotent execution required.

BEGIN;

WITH vendor_seed(name, description, icon, status) AS (
  VALUES
    ('云雾 AI', 'Synced from hono-api model catalog vendor: yunwu', NULL, 1)
),
insert_vendors AS (
  INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
  SELECT
    s.name,
    s.description,
    s.icon,
    s.status,
    EXTRACT(EPOCH FROM NOW())::bigint,
    EXTRACT(EPOCH FROM NOW())::bigint
  FROM vendor_seed AS s
  WHERE NOT EXISTS (
    SELECT 1
    FROM vendors AS existing
    WHERE existing.name = s.name
      AND existing.deleted_at IS NULL
  )
)
SELECT 1;

WITH vendor_seed(name, description, icon, status) AS (
  VALUES
    ('云雾 AI', 'Synced from hono-api model catalog vendor: yunwu', NULL, 1)
)
UPDATE vendors AS v
SET
  description = s.description,
  icon = s.icon,
  status = s.status,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS s
WHERE v.name = s.name
  AND v.deleted_at IS NULL;

WITH model_seed(model_name, description, icon, tags, vendor_name, endpoints, status, sync_official, name_rule) AS (
  VALUES
    ('nano-banana-fast', 'Yunwu Gemini image generation upstream gemini-2.5-flash-image', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('nano-banana-pro', 'Yunwu Gemini image generation upstream gemini-3-pro-image-preview', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('nanobanana2', 'Yunwu Gemini image generation upstream gemini-3.1-flash-image-preview', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('gemini-3-flash-preview', 'Yunwu Gemini multimodal upstream gemini-3-flash-preview', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('doubao-seedream-5-0-260128', 'Yunwu OpenAI image endpoint upstream doubao-seedream-5-0-260128', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('kling-v3', 'Yunwu video generation via /v1/videos upstream kling-v3', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('veo3.1-pro', 'Yunwu video generation via /v1/videos upstream veo3.1-pro', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('veo_3_1', 'Yunwu video generation via /v1/videos upstream veo_3_1', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('veo_3_1-fast', 'Yunwu video generation via /v1/videos upstream veo_3_1-fast', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('Seedance 2.0 Fast', 'Ark Seedance 2.0 Fast video generation submit /api/v3/contents/generations/tasks and query /api/v3/contents/generations/tasks/{id} upstream doubao-seedance-2-0-fast-260128', NULL, 'tapcanvas:kind=video,tapcanvas:request-model=doubao-seedance-2-0-fast-260128', NULL, 'openai-video', 1, 1, 0),
    ('Seedance 2.0', 'Ark Seedance 2.0 video generation submit /api/v3/contents/generations/tasks and query /api/v3/contents/generations/tasks/{id} upstream doubao-seedance-2-0-260128', NULL, 'tapcanvas:kind=video,tapcanvas:request-model=doubao-seedance-2-0-260128', NULL, 'openai-video', 1, 1, 0)
)
INSERT INTO models (
  model_name,
  description,
  icon,
  tags,
  vendor_id,
  endpoints,
  status,
  sync_official,
  created_time,
  updated_time,
  name_rule
)
SELECT
  m.model_name,
  m.description,
  m.icon,
  m.tags,
  v.id,
  m.endpoints,
  m.status,
  m.sync_official,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  m.name_rule
FROM model_seed AS m
LEFT JOIN vendors AS v
  ON v.name = m.vendor_name
 AND v.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM models AS existing
  WHERE existing.model_name = m.model_name
    AND existing.deleted_at IS NULL
);

WITH model_seed(model_name, description, icon, tags, vendor_name, endpoints, status, sync_official, name_rule) AS (
  VALUES
    ('nano-banana-fast', 'Yunwu Gemini image generation upstream gemini-2.5-flash-image', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('nano-banana-pro', 'Yunwu Gemini image generation upstream gemini-3-pro-image-preview', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('nanobanana2', 'Yunwu Gemini image generation upstream gemini-3.1-flash-image-preview', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('gemini-3-flash-preview', 'Yunwu Gemini multimodal upstream gemini-3-flash-preview', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('doubao-seedream-5-0-260128', 'Yunwu OpenAI image endpoint upstream doubao-seedream-5-0-260128', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('kling-v3', 'Yunwu video generation via /v1/videos upstream kling-v3', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('veo3.1-pro', 'Yunwu video generation via /v1/videos upstream veo3.1-pro', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('veo_3_1', 'Yunwu video generation via /v1/videos upstream veo_3_1', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('veo_3_1-fast', 'Yunwu video generation via /v1/videos upstream veo_3_1-fast', NULL, NULL, '云雾 AI', NULL, 1, 0, 0),
    ('Seedance 2.0 Fast', 'Ark Seedance 2.0 Fast video generation submit /api/v3/contents/generations/tasks and query /api/v3/contents/generations/tasks/{id} upstream doubao-seedance-2-0-fast-260128', NULL, 'tapcanvas:kind=video,tapcanvas:request-model=doubao-seedance-2-0-fast-260128', NULL, 'openai-video', 1, 1, 0),
    ('Seedance 2.0', 'Ark Seedance 2.0 video generation submit /api/v3/contents/generations/tasks and query /api/v3/contents/generations/tasks/{id} upstream doubao-seedance-2-0-260128', NULL, 'tapcanvas:kind=video,tapcanvas:request-model=doubao-seedance-2-0-260128', NULL, 'openai-video', 1, 1, 0)
)
UPDATE models AS target
SET
  description = src.description,
  icon = src.icon,
  tags = src.tags,
  vendor_id = vendor_row.id,
  endpoints = src.endpoints,
  status = src.status,
  sync_official = src.sync_official,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint,
  name_rule = src.name_rule
FROM model_seed AS src
LEFT JOIN vendors AS vendor_row
  ON vendor_row.name = src.vendor_name
 AND vendor_row.deleted_at IS NULL
WHERE target.model_name = src.model_name
  AND target.deleted_at IS NULL;

COMMIT;
