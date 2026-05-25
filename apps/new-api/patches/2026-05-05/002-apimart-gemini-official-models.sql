-- 002-apimart-gemini-official-models.sql
-- Purpose: add APIMart Gemini `-official` model aliases. Each official alias
--          routes to the corresponding non-official upstream model, while its
--          billing price is 4x the non-official APIMart Gemini price.
--
-- Added aliases:
--   gemini-2.5-flash-image-preview-official  -> gemini-2.5-flash-image-preview
--   gemini-3-pro-image-preview-official      -> gemini-3-pro-image-preview
--   gemini-3.1-flash-image-preview-official  -> gemini-3.1-flash-image-preview
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

WITH official_models(model_name, upstream_model, kind, price_kind, official_price) AS (VALUES
  ('gemini-2.5-flash-image-preview-official', 'gemini-2.5-flash-image-preview', 'image', 'price', 0.584::numeric),
  ('gemini-3-pro-image-preview-official',     'gemini-3-pro-image-preview',     'image', 'price', 1.8688::numeric),
  ('gemini-3.1-flash-image-preview-official', 'gemini-3.1-flash-image-preview', 'image', 'price', 1.4016::numeric)
),
apimart_vendor AS (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
),
source_models AS (
  SELECT
    official.model_name,
    official.upstream_model,
    official.kind,
    official.price_kind,
    official.official_price,
    source.description,
    source.icon,
    source.tags,
    source.endpoints,
    source.params_def,
    source.capabilities,
    source.name_rule
  FROM official_models AS official
  LEFT JOIN models AS source
    ON source.model_name = official.upstream_model
   AND source.deleted_at IS NULL
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, params_def, capabilities
)
SELECT
  source.model_name,
  'APIMart official-priced alias for upstream ' || source.upstream_model,
  source.icon,
  source.tags,
  vendor.id,
  source.endpoints,
  source.kind,
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  COALESCE(source.name_rule, 0),
  COALESCE(source.params_def, '[]'),
  COALESCE(NULLIF(source.capabilities, ''), '[]')
FROM source_models AS source
CROSS JOIN apimart_vendor AS vendor
WHERE NOT EXISTS (
  SELECT 1 FROM models AS existing
  WHERE existing.model_name = source.model_name
    AND existing.deleted_at IS NULL
);

WITH official_models(model_name, upstream_model, kind) AS (VALUES
  ('gemini-2.5-flash-image-preview-official', 'gemini-2.5-flash-image-preview', 'image'),
  ('gemini-3-pro-image-preview-official',     'gemini-3-pro-image-preview',     'image'),
  ('gemini-3.1-flash-image-preview-official', 'gemini-3.1-flash-image-preview', 'image')
),
apimart_vendor AS (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
),
source_models AS (
  SELECT
    official.model_name,
    official.upstream_model,
    official.kind,
    source.icon,
    source.tags,
    source.endpoints,
    source.params_def,
    source.capabilities,
    source.name_rule
  FROM official_models AS official
  LEFT JOIN models AS source
    ON source.model_name = official.upstream_model
   AND source.deleted_at IS NULL
)
UPDATE models AS target
SET description = 'APIMart official-priced alias for upstream ' || source.upstream_model,
    icon = source.icon,
    tags = source.tags,
    vendor_id = vendor.id,
    endpoints = source.endpoints,
    kind = source.kind,
    status = 1,
    sync_official = 0,
    deleted_at = NULL,
    name_rule = COALESCE(source.name_rule, target.name_rule, 0),
    params_def = COALESCE(source.params_def, target.params_def, '[]'),
    capabilities = COALESCE(NULLIF(source.capabilities, ''), target.capabilities, '[]'),
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM source_models AS source
CROSS JOIN apimart_vendor AS vendor
WHERE target.model_name = source.model_name;

-- Add official aliases to the APIMart channel CSV without dropping operator edits.
WITH official_models(model_name) AS (VALUES
  ('gemini-2.5-flash-image-preview-official'),
  ('gemini-3-pro-image-preview-official'),
  ('gemini-3.1-flash-image-preview-official')
),
expanded AS (
  SELECT
    channel.id,
    trim(item) AS model_name
  FROM channels AS channel
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(channel.models, ''), ',') AS item
  WHERE channel.name = 'apimart'
    AND channel.type = 59
    AND channel."group" = 'default'
  UNION
  SELECT channel.id, official.model_name
  FROM channels AS channel
  CROSS JOIN official_models AS official
  WHERE channel.name = 'apimart'
    AND channel.type = 59
    AND channel."group" = 'default'
),
joined AS (
  SELECT
    id,
    string_agg(model_name, ',' ORDER BY model_name) AS models
  FROM expanded
  WHERE model_name <> ''
  GROUP BY id
)
UPDATE channels AS channel
SET models = joined.models
FROM joined
WHERE channel.id = joined.id;

-- Route official aliases to the real APIMart upstream model ids.
UPDATE channels AS channel
SET model_mapping = (
  COALESCE(NULLIF(channel.model_mapping, '')::jsonb, '{}'::jsonb)
  || $json${
    "gemini-2.5-flash-image-preview-official": "gemini-2.5-flash-image-preview",
    "gemini-3-pro-image-preview-official": "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview-official": "gemini-3.1-flash-image-preview"
  }$json$::jsonb
)::text,
    base_url = 'https://api.apimart.ai'
WHERE channel.name = 'apimart'
  AND channel.type = 59
  AND channel."group" = 'default';

-- Enable official aliases for default + auto groups on the APIMart channel.
WITH official_models(model_name) AS (VALUES
  ('gemini-2.5-flash-image-preview-official'),
  ('gemini-3-pro-image-preview-official'),
  ('gemini-3.1-flash-image-preview-official')
),
ability_matrix AS (
  SELECT group_name, model_name
  FROM official_models
  CROSS JOIN (VALUES ('default'), ('auto')) AS groups(group_name)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT matrix.group_name, matrix.model_name, channel.id, true, 0, 0, 'apimart'
FROM ability_matrix AS matrix
JOIN channels AS channel
  ON channel.name = 'apimart'
 AND channel.type = 59
 AND channel."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight = EXCLUDED.weight,
    tag = EXCLUDED.tag;

-- Image ModelPrice = 4x non-official CNY premium scalar price.
INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  $json${
    "gemini-2.5-flash-image-preview-official": 0.584,
    "gemini-3-pro-image-preview-official": 1.8688,
    "gemini-3.1-flash-image-preview-official": 1.4016
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb)
  || EXCLUDED.value::jsonb
)::text;

\echo
\echo '----- APIMart Gemini official aliases -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params
FROM models
WHERE model_name IN (
  'gemini-2.5-flash-image-preview-official',
  'gemini-3-pro-image-preview-official',
  'gemini-3.1-flash-image-preview-official'
)
  AND deleted_at IS NULL
ORDER BY model_name;

\echo
\echo '----- APIMart Gemini official prices -----'
SELECT
  value::jsonb -> 'gemini-2.5-flash-image-preview-official' AS gemini_25_flash_image_official,
  value::jsonb -> 'gemini-3-pro-image-preview-official' AS gemini_3_pro_image_official,
  value::jsonb -> 'gemini-3.1-flash-image-preview-official' AS gemini_31_flash_image_official
FROM options
WHERE key = 'ModelPrice';

COMMIT;
