-- 004-add-wuyinkeji-gpt-image-2.sql
-- Purpose: register the wuyinkeji (速创 API) channel and seed gpt-image-2-suchuang.
-- Background: wuyinkeji is a custom async image/video API served via
--             ChannelType 58 implemented in relay/channel/task/wuyinkeji.
--             Submit: POST https://api.wuyinkeji.com/api/async/image_gpt
--             Poll:   GET  https://api.wuyinkeji.com/api/async/detail?id=...
-- Key: placeholder — fill in via new-api admin console after applying.
-- Scope: PostgreSQL only, data-only, idempotent execution required.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Seed vendor.
-- -----------------------------------------------------------------------------

WITH vendor_seed(name, description, icon, status) AS (
  VALUES
    ('速创 AI', 'Wuyinkeji (api.wuyinkeji.com) async image/video/audio provider', NULL, 1)
)
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
  SELECT 1 FROM vendors AS existing
  WHERE existing.name = s.name AND existing.deleted_at IS NULL
);

WITH vendor_seed(name, description, icon, status) AS (
  VALUES
    ('速创 AI', 'Wuyinkeji (api.wuyinkeji.com) async image/video/audio provider', NULL, 1)
)
UPDATE vendors AS v
SET
  description  = s.description,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS s
WHERE v.name = s.name AND v.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 2: Seed model gpt-image-2-suchuang (distinct from existing gpt-image-2
--         served via comfly and gpt-image-2-all served via yunwu).
-- -----------------------------------------------------------------------------

WITH model_seed(model_name, description, vendor_name) AS (
  VALUES
    ('gpt-image-2-suchuang', 'Wuyinkeji async image generation upstream gpt-image-2 (/api/async/image_gpt)', '速创 AI')
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
    ('gpt-image-2-suchuang', 'Wuyinkeji async image generation upstream gpt-image-2 (/api/async/image_gpt)', '速创 AI')
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
-- Step 3: Upsert channel (type 58 = ChannelTypeWuyinkeji, task-based).
--         Key is a placeholder — operator fills the real key via admin UI.
-- -----------------------------------------------------------------------------

WITH channel_seed(name, type, channel_group, models, status, base_url, key, priority, weight, tag) AS (
  VALUES
    ('wuyinkeji', 58, 'default', 'gpt-image-2-suchuang', 1, 'https://api.wuyinkeji.com', 'PLACEHOLDER_WUYINKEJI_KEY', 0, 0, 'wuyinkeji')
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
  NULL,
  NULL,
  NULL
FROM channel_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM channels AS existing
  WHERE existing.name = s.name
    AND existing.type = s.type
    AND existing."group" = s.channel_group
);

-- Keep non-credential metadata in sync; do NOT overwrite key/status/priority/weight/tag
-- (they may have been edited in the admin UI).
WITH channel_seed(name, type, channel_group, models, base_url) AS (
  VALUES
    ('wuyinkeji', 58, 'default', 'gpt-image-2-suchuang', 'https://api.wuyinkeji.com')
)
UPDATE channels AS target
SET
  models   = src.models,
  base_url = src.base_url
FROM channel_seed AS src
WHERE target.name = src.name
  AND target.type = src.type
  AND target."group" = src.channel_group;

-- -----------------------------------------------------------------------------
-- Step 4: Seed abilities for default + auto groups.
-- -----------------------------------------------------------------------------

WITH ability_seed(ability_group, model, channel_name, channel_type, channel_group, enabled, priority, weight, tag) AS (
  VALUES
    ('default', 'gpt-image-2-suchuang', 'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('auto',    'gpt-image-2-suchuang', 'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji')
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
-- Step 5: Seed ModelPrice — placeholder $0.02/image (upstream cost ≈ 0.1 CNY ≈ $0.014).
-- Merge strategy: existing DB values take priority (EXCLUDED || options).
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"gpt-image-2-suchuang": 0.02}'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
