-- 008-magic666-sora-2-oai-duration.sql
-- Purpose: align sora-2-oai duration options with Magic666 upstream.
--
-- Upstream rejects 10s and accepts only 4, 8, or 12 seconds.
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

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

COMMIT;
