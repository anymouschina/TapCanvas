-- Register HeyRoute's OpenAI Images-compatible image channel.
--
-- Provider contract (verified against HeyRoute's public capability docs):
--   Base URL: https://heyroute.ai
--   Endpoint: POST /v1/images/generations (and /v1/images/edits)
--   Auth: Authorization: Bearer <channels.key>
--
-- HeyRoute publishes the following image model IDs in its own catalog:
--   gpt-image-2
--   gemini-3.1-flash-image
--   gemini-3-pro-image
-- TapCanvas exposes the corresponding canonical Gemini preview IDs.
-- model_mapping therefore translates those public IDs without creating a
-- second product or pricing table:
--   gemini-3.1-flash-image-preview -> gemini-3.1-flash-image
--   gemini-3-pro-image-preview      -> gemini-3-pro-image
--
-- The channel is an independent, explicitly opt-in route. Existing image
-- channels keep their configuration; administrators enable HeyRoute with their
-- own credential and can adjust routing priority in the channel editor.
--
-- Security: the credential is intentionally not part of this patch. The
-- channel is created with an empty key and must be populated explicitly with
-- the new-api channel editor before explicitly enabling the channel.
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- The route reuses three canonical image models. They used to arrive with the
-- Lluban seed; that snapshot now follows Lluban's live catalog, so this patch
-- creates their catalog metadata itself when it is missing. Existing rows keep
-- their owner, metadata and status.
CREATE TEMP TABLE heyroute_canonical_image_models (
  payload jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO heyroute_canonical_image_models (payload)
VALUES
  ('{"model_name":"gemini-3-pro-image-preview","description":"APIMart upstream gemini-3-pro-image-preview","tags":"","endpoints":["gemini","openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[\n    {\"key\":\"size\",\"type\":\"enum\",\"label\":\"宽高比\",\"default\":\"1:1\",\n     \"options\":[\n       {\"value\":\"1:1\",\"label\":\"1:1\"},\n       {\"value\":\"2:3\",\"label\":\"2:3\"},\n       {\"value\":\"3:2\",\"label\":\"3:2\"},\n       {\"value\":\"3:4\",\"label\":\"3:4\"},\n       {\"value\":\"4:3\",\"label\":\"4:3\"},\n       {\"value\":\"4:5\",\"label\":\"4:5\"},\n       {\"value\":\"5:4\",\"label\":\"5:4\"},\n       {\"value\":\"9:16\",\"label\":\"9:16\"},\n       {\"value\":\"16:9\",\"label\":\"16:9\"},\n       {\"value\":\"21:9\",\"label\":\"21:9\"}\n     ]},\n    {\"key\":\"image_size\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"1K\",\n     \"options\":[\n       {\"value\":\"1K\",\"label\":\"1K\"},\n       {\"value\":\"2K\",\"label\":\"2K\"},\n       {\"value\":\"4K\",\"label\":\"4K\"}\n     ]},\n    {\"key\":\"urls\",\"type\":\"array\",\"item_type\":\"string\",\"label\":\"参考图 URL\",\"scope\":\"per_request\",\n     \"description\":\"可选，图生图参考图 URL 列表\"}\n  ]","name_rule":0}'::jsonb),
  ('{"model_name":"gemini-3.1-flash-image-preview","description":"APIMart upstream gemini-3.1-flash-image-preview","tags":"","endpoints":["gemini","openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[\n    {\"key\":\"size\",\"type\":\"enum\",\"label\":\"宽高比\",\"default\":\"1:1\",\n     \"options\":[\n       {\"value\":\"1:1\",\"label\":\"1:1\"},\n       {\"value\":\"1:4\",\"label\":\"1:4\"},\n       {\"value\":\"1:8\",\"label\":\"1:8\"},\n       {\"value\":\"2:3\",\"label\":\"2:3\"},\n       {\"value\":\"3:2\",\"label\":\"3:2\"},\n       {\"value\":\"3:4\",\"label\":\"3:4\"},\n       {\"value\":\"4:1\",\"label\":\"4:1\"},\n       {\"value\":\"4:3\",\"label\":\"4:3\"},\n       {\"value\":\"4:5\",\"label\":\"4:5\"},\n       {\"value\":\"5:4\",\"label\":\"5:4\"},\n       {\"value\":\"8:1\",\"label\":\"8:1\"},\n       {\"value\":\"9:16\",\"label\":\"9:16\"},\n       {\"value\":\"16:9\",\"label\":\"16:9\"},\n       {\"value\":\"21:9\",\"label\":\"21:9\"}\n     ]},\n    {\"key\":\"image_size\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"1K\",\n     \"options\":[\n       {\"value\":\"512\",\"label\":\"512\"},\n       {\"value\":\"1K\",\"label\":\"1K\"},\n       {\"value\":\"2K\",\"label\":\"2K\"},\n       {\"value\":\"4K\",\"label\":\"4K\"}\n     ]},\n    {\"key\":\"urls\",\"type\":\"array\",\"item_type\":\"string\",\"label\":\"参考图 URL\",\"scope\":\"per_request\",\n     \"description\":\"可选，图生图参考图 URL 列表\"}\n  ]","name_rule":0}'::jsonb),
  ('{"model_name":"gpt-image-2","description":"OpenAI image generation gpt-image-2 — served via comfly proxy","tags":"","endpoints":["openai","openai-response","openai-response-compact","image-generation","embeddings"],"kind":"image","capabilities":"[]","params_def":"[{\"key\": \"size\", \"type\": \"enum\", \"label\": \"宽高比\", \"default\": \"auto\", \"options\": [{\"label\": \"自动\", \"value\": \"auto\"}, {\"label\": \"1:1\", \"value\": \"1:1\"}, {\"label\": \"16:9 横\", \"value\": \"16:9\"}, {\"label\": \"9:16 竖\", \"value\": \"9:16\"}, {\"label\": \"4:3\", \"value\": \"4:3\"}, {\"label\": \"3:4\", \"value\": \"3:4\"}, {\"label\": \"3:2 横\", \"value\": \"3:2\"}, {\"label\": \"2:3 竖\", \"value\": \"2:3\"}, {\"label\": \"5:4\", \"value\": \"5:4\"}, {\"label\": \"4:5\", \"value\": \"4:5\"}, {\"label\": \"21:9 超宽\", \"value\": \"21:9\"}]}, {\"key\": \"image_size\", \"type\": \"enum\", \"label\": \"分辨率\", \"default\": \"1K\", \"options\": [{\"label\": \"1K\", \"value\": \"1K\"}, {\"label\": \"2K\", \"value\": \"2K\"}, {\"label\": \"4K\", \"value\": \"4K\"}]}, {\"key\": \"urls\", \"type\": \"array\", \"label\": \"参考图 URL\", \"scope\": \"per_request\", \"item_type\": \"string\", \"description\": \"可选，用于图生图的参考图 URL 列表\"}, {\"key\": \"quality\", \"type\": \"enum\", \"label\": \"质量\", \"default\": \"low\", \"options\": [{\"label\": \"低画质\", \"value\": \"low\"}, {\"label\": \"标准画质\", \"value\": \"medium\"}, {\"label\": \"高画质\", \"value\": \"high\"}]}]","name_rule":0}'::jsonb);

INSERT INTO models (
  model_name, description, icon, tags, endpoints, kind, capabilities, status,
  sync_official, created_time, updated_time, name_rule, params_def
)
SELECT
  payload ->> 'model_name',
  NULLIF(payload ->> 'description', ''),
  NULL,
  'heyroute',
  (payload -> 'endpoints')::text,
  payload ->> 'kind',
  COALESCE(NULLIF(payload ->> 'capabilities', ''), '[]'),
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  COALESCE((payload ->> 'name_rule')::integer, 0),
  payload ->> 'params_def'
FROM heyroute_canonical_image_models
WHERE NOT EXISTS (
  SELECT 1 FROM models
  WHERE model_name = payload ->> 'model_name' AND deleted_at IS NULL
);

-- Do not publish a provider-specific model with no product/catalog contract
-- on the Hono side.
DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM models
    WHERE model_name IN (
      'gpt-image-2',
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview'
    )
      AND deleted_at IS NULL
      AND status = 1
      AND kind = 'image'
  ) <> 3 THEN
    RAISE EXCEPTION 'expected exactly three enabled canonical image models before adding HeyRoute';
  END IF;

  IF (SELECT COUNT(*) FROM channels WHERE name = 'heyroute-image') > 1 THEN
    RAISE EXCEPTION 'expected at most one heyroute-image channel';
  END IF;
END
$$;

INSERT INTO channels (
  name,
  type,
  "group",
  models,
  model_mapping,
  status,
  base_url,
  key,
  created_time,
  test_time,
  priority,
  weight,
  tag,
  setting,
  test_model,
  auto_ban,
  param_override,
  header_override,
  remark
)
SELECT
  'heyroute-image',
  1,
  'default',
  'gpt-image-2,gemini-3.1-flash-image-preview,gemini-3-pro-image-preview',
  '{"gemini-3.1-flash-image-preview":"gemini-3.1-flash-image","gemini-3-pro-image-preview":"gemini-3-pro-image"}',
  2,
  'https://heyroute.ai',
  '',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  100,
  100,
  'heyroute-image',
  '{"default_protocol":{"protocol":"openai"},"model_protocols":{"gpt-image-2":{"protocol":"openai"},"gemini-3.1-flash-image-preview":{"protocol":"openai"},"gemini-3-pro-image-preview":{"protocol":"openai"}},"force_format":false,"thinking_to_content":false,"proxy":"","pass_through_body_enabled":false,"system_prompt":"","system_prompt_override":false}',
  'gpt-image-2',
  1,
  NULL,
  NULL,
  'HeyRoute OpenAI Images-compatible image channel; canonical GPT Image 2 and Gemini image models'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'heyroute-image'
);

-- Re-running the patch refreshes only deployment-owned connection fields. The
-- credential is deliberately left untouched so it can only be changed through
-- an explicit administrator operation.
UPDATE channels
SET type = 1,
    "group" = 'default',
    models = 'gpt-image-2,gemini-3.1-flash-image-preview,gemini-3-pro-image-preview',
    model_mapping = '{"gemini-3.1-flash-image-preview":"gemini-3.1-flash-image","gemini-3-pro-image-preview":"gemini-3-pro-image"}',
    base_url = 'https://heyroute.ai',
    priority = 100,
    weight = 100,
    tag = 'heyroute-image',
    setting = '{"default_protocol":{"protocol":"openai"},"model_protocols":{"gpt-image-2":{"protocol":"openai"},"gemini-3.1-flash-image-preview":{"protocol":"openai"},"gemini-3-pro-image-preview":{"protocol":"openai"}},"force_format":false,"thinking_to_content":false,"proxy":"","pass_through_body_enabled":false,"system_prompt":"","system_prompt_override":false}',
    test_model = 'gpt-image-2',
    auto_ban = 1,
    param_override = NULL,
    header_override = NULL,
    remark = 'HeyRoute OpenAI Images-compatible image channel; canonical GPT Image 2 and Gemini image models'
WHERE name = 'heyroute-image';

INSERT INTO abilities (
  "group",
  model,
  channel_id,
  enabled,
  priority,
  weight,
  tag
)
SELECT
  'default',
  model_name,
  channel.id,
  channel.status = 1 AND length(btrim(channel.key)) > 0,
  100,
  100,
  'heyroute-image'
FROM channels AS channel
CROSS JOIN (VALUES
  ('gpt-image-2'),
  ('gemini-3.1-flash-image-preview'),
  ('gemini-3-pro-image-preview')
) AS models(model_name)
WHERE channel.name = 'heyroute-image'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight = EXCLUDED.weight,
    tag = EXCLUDED.tag;

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM channels AS channel
    JOIN abilities AS ability ON ability.channel_id = channel.id
    WHERE channel.name = 'heyroute-image'
      AND channel.type = 1
      AND channel.base_url = 'https://heyroute.ai'
      AND channel.setting::jsonb #>> '{default_protocol,protocol}' = 'openai'
      AND ability."group" = 'default'
      AND ability.model IN (
        'gpt-image-2',
        'gemini-3.1-flash-image-preview',
        'gemini-3-pro-image-preview'
      )
      AND ability.enabled = (channel.status = 1 AND length(btrim(channel.key)) > 0)
  ) <> 3 THEN
    RAISE EXCEPTION 'HeyRoute image channel/ability invariant failed';
  END IF;
END
$$;

COMMIT;
