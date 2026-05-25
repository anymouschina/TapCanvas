-- 001-gpt-image-2-4k-params.sql
-- Purpose: restore 4K image_size options for gpt-image-2 model variants and
--          encode the product rule that 4K only supports 16:9 or 9:16.
--
-- Background:
--   The live GET /api/models/params on port 4455 returns image_size options
--   [1K, 2K] for gpt-image-2 and gpt-image-2-official. Earlier patches added
--   4K for some variants, but the running new-api DB no longer reflects it.
--
-- Scope: PostgreSQL only, data-only, idempotent.
-- After applying: restart new-api or clear model metadata cache.

\set ON_ERROR_STOP on

BEGIN;

UPDATE models
SET
  kind = 'image',
  capabilities = CASE
    WHEN capabilities IS NULL OR capabilities = '' THEN '["reference_images"]'
    ELSE capabilities
  END,
  params_def = $json$[
    {
      "key": "size",
      "type": "enum",
      "label": "宽高比",
      "default": "auto",
      "options": [
        {"value": "auto", "label": "自动"},
        {"value": "1:1", "label": "1:1"},
        {"value": "16:9", "label": "16:9 横"},
        {"value": "9:16", "label": "9:16 竖"},
        {"value": "3:2", "label": "3:2 横"},
        {"value": "2:3", "label": "2:3 竖"}
      ]
    },
    {
      "key": "image_size",
      "type": "enum",
      "label": "分辨率",
      "default": "1K",
      "options": [
        {"value": "1K", "label": "1K"},
        {"value": "2K", "label": "2K"},
        {
          "value": "4K",
          "label": "4K",
          "whenSelected": {
            "aspectRatioOptions": ["16:9", "9:16"]
          }
        }
      ]
    },
    {
      "key": "urls",
      "type": "array",
      "item_type": "string",
      "label": "参考图 URL",
      "scope": "per_request",
      "description": "可选，用于图生图的参考图 URL 列表"
    }
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
  'gpt-image-2',
  'gpt-image-2-apimart',
  'gpt-image-2-suchuang',
  'gpt-image-2-all',
  'gpt-image-2-official',
  'gpt-image-2-official-apimart'
)
  AND deleted_at IS NULL;

\echo
\echo '----- gpt-image-2 image_size options after patch -----'
SELECT model_name,
       jsonb_path_query_array(
         params_def::jsonb,
         '$[*] ? (@.key == "image_size").options[*].value'
       ) AS image_size_values,
       jsonb_path_query_array(
         params_def::jsonb,
         '$[*] ? (@.key == "image_size").options[*] ? (@.value == "4K").whenSelected.aspectRatioOptions[*]'
       ) AS image_size_4k_aspect_ratios
FROM models
WHERE model_name IN (
  'gpt-image-2',
  'gpt-image-2-apimart',
  'gpt-image-2-suchuang',
  'gpt-image-2-all',
  'gpt-image-2-official',
  'gpt-image-2-official-apimart'
)
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
