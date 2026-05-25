-- 006-add-gpt-image-2-vip.sql
-- Purpose: Add gpt-image-2-vip model routed to a dedicated RightCodes VIP channel.
--
-- Routing logic:
--   gpt-image-2-vip  →  rightcodes-draw-vip (priority 20, type 60)
--   VIP channel maps "gpt-image-2-vip" → "gpt-image-2" upstream.
--
-- Pricing: overridden by fixedImagePricingRules (same as gpt-image-2):
--   1K = 1 credit, 2K = 2 credits, 4K = 3 credits.
--
-- After applying: replace PLACEHOLDER_RIGHTCODES_VIP_KEY with the real key.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Seed model.
-- ---------------------------------------------------------------------------

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'gpt-image-2-vip',
  'OpenAI GPT Image 2 VIP — RightCodes VIP channel, supports 1K/2K/4K',
  NULL, NULL, v.id, NULL, 'image', 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM (SELECT id FROM vendors WHERE name = 'RightCodes' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gpt-image-2-vip' AND deleted_at IS NULL
);

-- ---------------------------------------------------------------------------
-- Step 2: Create VIP channel.
-- ---------------------------------------------------------------------------

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT
  'rightcodes-draw-vip', 60, 'default',
  'gpt-image-2-vip',
  '{"gpt-image-2-vip": "gpt-image-2"}',
  1, 'https://www.right.codes/draw', 'PLACEHOLDER_RIGHTCODES_VIP_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 20, 0, 'rightcodes-vip',
  NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels
  WHERE name = 'rightcodes-draw-vip' AND type = 60 AND "group" = 'default'
);

-- Sync models/model_mapping on re-runs; leave key/status/priority untouched.
UPDATE channels
SET models        = 'gpt-image-2-vip',
    model_mapping = '{"gpt-image-2-vip": "gpt-image-2"}',
    base_url      = 'https://www.right.codes/draw'
WHERE name = 'rightcodes-draw-vip' AND type = 60 AND "group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 3: Seed abilities.
-- ---------------------------------------------------------------------------

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group, 'gpt-image-2-vip', c.id, true, 0, 0, 'rightcodes-vip'
FROM (VALUES ('default'), ('auto')) AS g(ability_group)
JOIN channels AS c
  ON c.name = 'rightcodes-draw-vip' AND c.type = 60 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = true,
    tag      = 'rightcodes-vip';

COMMIT;
