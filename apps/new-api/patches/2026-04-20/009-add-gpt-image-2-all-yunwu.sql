-- 009-add-gpt-image-2-all-yunwu.sql
-- Purpose: Add gpt-image-2-all model served via yunwu-openai-image channel.
-- Pricing: 4 × nanobanana2 (banana2) = $0.04/image.
-- Idempotent: safe to re-run.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Upsert model.
-- -----------------------------------------------------------------------------

WITH model_seed(model_name, description, vendor_name) AS (
  VALUES
    ('gpt-image-2-all', 'Yunwu OpenAI image generation upstream gpt-image-2-all', '云雾 AI')
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
  s.model_name,
  s.description,
  NULL,
  NULL,
  v.id,
  NULL,
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM model_seed AS s
JOIN vendors AS v ON v.name = s.vendor_name AND v.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM models AS m
  WHERE m.model_name = s.model_name AND m.deleted_at IS NULL
);

WITH model_seed(model_name, description, vendor_name) AS (
  VALUES
    ('gpt-image-2-all', 'Yunwu OpenAI image generation upstream gpt-image-2-all', '云雾 AI')
)
UPDATE models AS target
SET
  description  = src.description,
  vendor_id    = v.id,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM model_seed AS src
JOIN vendors AS v ON v.name = src.vendor_name AND v.deleted_at IS NULL
WHERE target.model_name = src.model_name
  AND target.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 2: Add gpt-image-2-all to yunwu-openai-image channel models list.
-- -----------------------------------------------------------------------------

UPDATE channels
SET
  models = models || ',gpt-image-2-all'
WHERE name = 'yunwu-openai-image'
  AND type = 1
  AND "group" = 'default'
  AND models NOT LIKE '%gpt-image-2-all%';

-- -----------------------------------------------------------------------------
-- Step 3: Seed abilities.
-- -----------------------------------------------------------------------------

WITH ability_seed(ability_group, model, channel_name, channel_type, channel_group, enabled, priority, weight, tag) AS (
  VALUES
    ('default', 'gpt-image-2-all', 'yunwu-openai-image', 1, 'default', true, 0, 0, 'yunwu-openai-image'),
    ('auto',    'gpt-image-2-all', 'yunwu-openai-image', 1, 'default', true, 0, 0, 'yunwu-openai-image')
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
  s.ability_group,
  s.model,
  c.id,
  s.enabled,
  s.priority,
  s.weight,
  s.tag
FROM ability_seed AS s
JOIN channels AS c
  ON c.name = s.channel_name
 AND c.type = s.channel_type
 AND c."group" = s.channel_group
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled  = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight   = EXCLUDED.weight,
  tag      = EXCLUDED.tag;

-- -----------------------------------------------------------------------------
-- Step 4: Seed ModelPrice — $0.04/image (4 × nanobanana2 $0.01).
-- Merge strategy: existing DB values take priority (EXCLUDED || options).
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"gpt-image-2-all": 0.04}'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
