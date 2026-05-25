-- 006-add-wuyinkeji-extra-models.sql
-- Purpose: register additional wuyinkeji-backed models that correspond to
--          existing DB entries (nano-banana family + veo3.1 family), and
--          attach them to the existing 'wuyinkeji' channel seeded by 004.
-- Model names use the -suchuang suffix to stay distinct from the yunwu
-- equivalents (`nano-banana-fast` / `nano-banana-pro` / `nanobanana2` /
-- `veo_3_1-fast` / `veo3.1-pro`) even though the upstream products share names.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Seed 5 new models under the 速创 AI vendor.
-- -----------------------------------------------------------------------------

WITH model_seed(model_name, description, vendor_name) AS (
  VALUES
    ('nano-banana-fast-suchuang', 'Wuyinkeji async image generation upstream NanoBanana (/api/async/image_nanoBanana)',         '速创 AI'),
    ('nano-banana-pro-suchuang',  'Wuyinkeji async image generation upstream NanoBanana-pro (/api/async/image_nanoBanana_pro)', '速创 AI'),
    ('nanobanana2-suchuang',      'Wuyinkeji async image generation upstream NanoBanana2 (/api/async/image_nanoBanana2)',       '速创 AI'),
    ('veo3.1-fast-suchuang',      'Wuyinkeji async video generation upstream veo3.1_fast (/api/async/video_veo3.1_fast)',       '速创 AI'),
    ('veo3.1-pro-suchuang',       'Wuyinkeji async video generation upstream veo3.1_pro (/api/async/video_veo3.1_pro)',         '速创 AI')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  s.model_name, s.description, NULL, NULL, v.id, NULL, 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM model_seed AS s
JOIN vendors AS v ON v.name = s.vendor_name AND v.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM models AS m
  WHERE m.model_name = s.model_name AND m.deleted_at IS NULL
);

WITH model_seed(model_name, description, vendor_name) AS (
  VALUES
    ('nano-banana-fast-suchuang', 'Wuyinkeji async image generation upstream NanoBanana (/api/async/image_nanoBanana)',         '速创 AI'),
    ('nano-banana-pro-suchuang',  'Wuyinkeji async image generation upstream NanoBanana-pro (/api/async/image_nanoBanana_pro)', '速创 AI'),
    ('nanobanana2-suchuang',      'Wuyinkeji async image generation upstream NanoBanana2 (/api/async/image_nanoBanana2)',       '速创 AI'),
    ('veo3.1-fast-suchuang',      'Wuyinkeji async video generation upstream veo3.1_fast (/api/async/video_veo3.1_fast)',       '速创 AI'),
    ('veo3.1-pro-suchuang',       'Wuyinkeji async video generation upstream veo3.1_pro (/api/async/video_veo3.1_pro)',         '速创 AI')
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
-- Step 2: Extend the wuyinkeji channel's models list to include all 6 models.
--         Idempotent: always sets the full list rather than appending.
-- -----------------------------------------------------------------------------

UPDATE channels
SET models = 'gpt-image-2-suchuang,nano-banana-fast-suchuang,nano-banana-pro-suchuang,nanobanana2-suchuang,veo3.1-fast-suchuang,veo3.1-pro-suchuang'
WHERE name = 'wuyinkeji'
  AND type = 58
  AND "group" = 'default';

-- -----------------------------------------------------------------------------
-- Step 3: Seed abilities for default + auto groups, 5 new models × 2 groups.
-- -----------------------------------------------------------------------------

WITH ability_seed(ability_group, model, channel_name, channel_type, channel_group, enabled, priority, weight, tag) AS (
  VALUES
    ('default', 'nano-banana-fast-suchuang', 'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('auto',    'nano-banana-fast-suchuang', 'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('default', 'nano-banana-pro-suchuang',  'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('auto',    'nano-banana-pro-suchuang',  'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('default', 'nanobanana2-suchuang',      'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('auto',    'nanobanana2-suchuang',      'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('default', 'veo3.1-fast-suchuang',      'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('auto',    'veo3.1-fast-suchuang',      'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('default', 'veo3.1-pro-suchuang',       'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji'),
    ('auto',    'veo3.1-pro-suchuang',       'wuyinkeji', 58, 'default', true, 0, 0, 'wuyinkeji')
)
INSERT INTO abilities (
  "group", model, channel_id, enabled, priority, weight, tag
)
SELECT
  s.ability_group, s.model, c.id, s.enabled, s.priority, s.weight, s.tag
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
-- Step 4: Seed ModelPrice — placeholders (admin can override via UI).
--   Pricing below is derived from the doc pages: nanobanana2 ≈ $0.01/image
--   (same as existing nanobanana2 which we'd expect to match), veo3.1_fast
--   placeholder $0.10/video, veo3.1_pro placeholder $0.20/video. Adjust as
--   needed once real upstream pricing is confirmed.
-- Merge strategy: existing DB values take priority (EXCLUDED || options).
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"nano-banana-fast-suchuang": 0.01, "nano-banana-pro-suchuang": 0.04, "nanobanana2-suchuang": 0.01, "veo3.1-fast-suchuang": 0.10, "veo3.1-pro-suchuang": 0.20}'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
