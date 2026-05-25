-- 003-seed-channels-abilities.sql
-- Purpose: seed or upsert channels and abilities after vendors/models/options exist.
-- Source: local tapcanvas_new_api canonical data as of 2026-04-18.
-- Scope: use business-key lookup; never rely on exported local numeric ids.

BEGIN;

WITH channel_seed(name, type, channel_group, models, status, base_url, key, priority, weight, tag, setting, param_override, header_override) AS (
  VALUES
    ('yunwu-gemini', 24, 'default', 'gemini-2.5-flash-image,gemini-3-flash-preview,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview', 1, 'https://yunwu.ai', 'REPLACE_WITH_YUNWU_API_KEY', 0, 0, 'yunwu-gemini', NULL, NULL, NULL),
    ('yunwu-openai-image', 1, 'default', 'doubao-seedream-5-0-260128', 1, 'https://yunwu.ai', 'REPLACE_WITH_YUNWU_API_KEY', 0, 0, 'yunwu-openai-image', NULL, '{response_format:url,watermark:false}', NULL),
    ('yunwu-openai-video', 1, 'default', 'kling-v3,kling-video-o1,veo_3_1,veo_3_1-fast,veo3.1-pro', 1, 'https://yunwu.ai', 'REPLACE_WITH_YUNWU_API_KEY', 0, 0, 'yunwu-openai-video', NULL, NULL, NULL),
    ('ark-doubao-video', 54, 'default', 'doubao-seedance-2-0-260128,doubao-seedance-2-0-fast-260128', 1, 'https://ark.cn-beijing.volces.com', 'REPLACE_WITH_ARK_API_KEY', 0, 0, NULL, NULL, NULL, NULL)
)
INSERT INTO channels (
  name,
  type,
  "group",
  models,
  status,
  base_url,
  key,
  created_time,
  test_time,
  priority,
  weight,
  tag,
  setting,
  param_override,
  header_override
)
SELECT
  s.name,
  s.type,
  s.channel_group,
  s.models,
  s.status,
  s.base_url,
  s.key,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  s.priority,
  s.weight,
  s.tag,
  s.setting,
  s.param_override,
  s.header_override
FROM channel_seed AS s
WHERE NOT EXISTS (
  SELECT 1
  FROM channels AS existing
  WHERE existing.name = s.name
    AND existing.type = s.type
    AND existing."group" = s.channel_group
);

-- -----------------------------------------------------------------------------
-- Step 2: Update existing channels by the chosen business identity.
-- -----------------------------------------------------------------------------
WITH channel_seed(
  name,
  type,
  channel_group,
  models,
  status,
  base_url,
  key,
  priority,
  weight,
  tag,
  setting,
  param_override,
  header_override
) AS (
  VALUES
    ('yunwu-gemini', 24, 'default', 'gemini-2.5-flash-image,gemini-3-flash-preview,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview', 1, 'https://yunwu.ai', 'REPLACE_WITH_YUNWU_API_KEY', 0, 0, 'yunwu-gemini', NULL, NULL, NULL),
    ('yunwu-openai-image', 1, 'default', 'doubao-seedream-5-0-260128', 1, 'https://yunwu.ai', 'REPLACE_WITH_YUNWU_API_KEY', 0, 0, 'yunwu-openai-image', NULL, '{response_format:url,watermark:false}', NULL),
    ('yunwu-openai-video', 1, 'default', 'kling-v3,kling-video-o1,veo_3_1,veo_3_1-fast,veo3.1-pro', 1, 'https://yunwu.ai', 'REPLACE_WITH_YUNWU_API_KEY', 0, 0, 'yunwu-openai-video', NULL, NULL, NULL),
    ('ark-doubao-video', 54, 'default', 'doubao-seedance-2-0-260128,doubao-seedance-2-0-fast-260128', 1, 'https://ark.cn-beijing.volces.com', 'REPLACE_WITH_ARK_API_KEY', 0, 0, NULL, NULL, NULL, NULL)
)
UPDATE channels AS target
SET
  models = src.models,
  status = src.status,
  base_url = src.base_url,
  key = src.key,
  priority = src.priority,
  weight = src.weight,
  tag = src.tag,
  setting = src.setting,
  param_override = src.param_override,
  header_override = src.header_override
FROM channel_seed AS src
WHERE target.name = src.name
  AND target.type = src.type
  AND target."group" = src.channel_group;

WITH ability_seed(ability_group, model, channel_name, channel_type, channel_group, enabled, priority, weight, tag) AS (
  VALUES
    ('default', 'gemini-3-flash-preview', 'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini'),
    ('default', 'nano-banana-fast', 'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini'),
    ('default', 'nano-banana-pro', 'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini'),
    ('default', 'nanobanana2', 'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini'),
    ('default', 'doubao-seedream-5-0-260128', 'yunwu-openai-image', 1, 'default', true, 0, 0, 'yunwu-openai-image'),
    ('default', 'kling-v3', 'yunwu-openai-video', 1, 'default', true, 0, 0, 'yunwu-openai-video'),
    ('default', 'veo3.1-pro', 'yunwu-openai-video', 1, 'default', true, 0, 0, 'yunwu-openai-video'),
    ('default', 'veo_3_1', 'yunwu-openai-video', 1, 'default', true, 0, 0, 'yunwu-openai-video'),
    ('default', 'veo_3_1-fast', 'yunwu-openai-video', 1, 'default', true, 0, 0, 'yunwu-openai-video')
)
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
  a.ability_group,
  a.model,
  c.id,
  a.enabled,
  a.priority,
  a.weight,
  a.tag
FROM ability_seed AS a
JOIN channels AS c
  ON c.name = a.channel_name
 AND c.type = a.channel_type
 AND c."group" = a.channel_group
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

COMMIT;
