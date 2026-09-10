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
-- TapCanvas already exposes the corresponding canonical Gemini preview IDs.
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

-- The route reuses the three canonical image models already maintained by
-- TapCanvas. Do not publish a provider-specific model with no product/catalog
-- contract on the Hono side.
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
