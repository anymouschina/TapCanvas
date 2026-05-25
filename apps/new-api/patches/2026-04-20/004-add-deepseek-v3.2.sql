-- 004-add-deepseek-v3.2.sql
-- Purpose: seed deepseek-v3.2 model, channel, and abilities.
-- Background: DeepSeek-V3.2 is the first model combining thinking with tool use,
--             supporting both thinking and non-thinking modes for tool calls.
--             Served via yunwu.ai OpenAI-compatible endpoint (/v1/chat/completions).
-- Scope: PostgreSQL only, data-only, idempotent execution required.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Seed model (insert if absent, update if present).
-- -----------------------------------------------------------------------------

WITH model_seed(model_name, description, icon, tags, vendor_name, endpoints, status, sync_official, name_rule) AS (
  VALUES
    ('deepseek-v3.2', 'Yunwu DeepSeek-V3.2 chat upstream deepseek-v3.2 — first model combining thinking with tool use, supports both thinking and non-thinking modes', NULL, NULL, '云雾 AI', NULL, 1, 0, 0)
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
    ('deepseek-v3.2', 'Yunwu DeepSeek-V3.2 chat upstream deepseek-v3.2 — first model combining thinking with tool use, supports both thinking and non-thinking modes', NULL, NULL, '云雾 AI', NULL, 1, 0, 0)
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

-- -----------------------------------------------------------------------------
-- Step 2: Upsert channel.
-- deepseek-v3.2 → yunwu-deepseek (type 1, OpenAI-compatible channel).
-- -----------------------------------------------------------------------------

WITH channel_seed(name, type, channel_group, models, status, base_url, key, priority, weight, tag, setting, param_override, header_override) AS (
  VALUES
    ('yunwu-deepseek', 1, 'default', 'deepseek-v3.2', 1, 'https://yunwu.ai', 'REPLACE_WITH_YUNWU_API_KEY', 0, 0, 'yunwu-deepseek', NULL, NULL, NULL)
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

WITH channel_seed(name, type, channel_group, models, status, base_url, key, priority, weight, tag, setting, param_override, header_override) AS (
  VALUES
    ('yunwu-deepseek', 1, 'default', 'deepseek-v3.2', 1, 'https://yunwu.ai', 'REPLACE_WITH_YUNWU_API_KEY', 0, 0, 'yunwu-deepseek', NULL, NULL, NULL)
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

-- -----------------------------------------------------------------------------
-- Step 3: Upsert abilities.
-- -----------------------------------------------------------------------------

WITH ability_seed(ability_group, model, channel_name, channel_type, channel_group, enabled, priority, weight, tag) AS (
  VALUES
    ('default', 'deepseek-v3.2', 'yunwu-deepseek', 1, 'default', true, 0, 0, 'yunwu-deepseek'),
    ('auto',    'deepseek-v3.2', 'yunwu-deepseek', 1, 'default', true, 0, 0, 'yunwu-deepseek'),
    ('codex',   'deepseek-v3.2', 'yunwu-deepseek', 1, 'default', true, 0, 0, 'yunwu-deepseek')
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
