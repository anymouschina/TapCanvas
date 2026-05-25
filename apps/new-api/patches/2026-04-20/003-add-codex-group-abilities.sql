-- 003-add-codex-group-abilities.sql
-- Purpose: add abilities for the "codex" client group so tokens assigned to
--          the "codex" group can call gemini chat models via the yunwu-gemini channel.
-- Background: xiangyu-admin portal relay uses NEW_API_INTERNAL_TOKEN which belongs
--             to the "codex" token group. All existing abilities are in "default"
--             group only → "分组 codex 下模型 X 无可用渠道". This patch mirrors the
--             required gemini chat abilities into the "codex" group.
-- Scope: PostgreSQL only, data-only, idempotent execution required.

BEGIN;

WITH ability_seed(ability_group, model, channel_name, channel_type, channel_group, enabled, priority, weight, tag) AS (
  VALUES
    ('codex', 'gemini-3.1-pro-preview', 'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini'),
    ('codex', 'gemini-3-flash-preview', 'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini'),
    ('codex', 'nano-banana-fast',       'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini'),
    ('codex', 'nano-banana-pro',        'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini'),
    ('codex', 'nanobanana2',            'yunwu-gemini', 24, 'default', true, 0, 0, 'yunwu-gemini')
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
