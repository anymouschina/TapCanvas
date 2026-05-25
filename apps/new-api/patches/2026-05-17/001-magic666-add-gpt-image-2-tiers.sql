-- 001-magic666-add-gpt-image-2-tiers.sql
-- Purpose: magic666 channel supports gpt-image-2 (1K) and gpt-image-2-vip (2K)
--          in addition to gpt-image-2-pro (4K) which it already has.
--
-- Routing after this patch:
--   gpt-image-2      (1K) → magic666(99) > rightcodes-draw(9) > apimart(1)
--   gpt-image-2-vip  (2K) → magic666(99) > rightcodes-draw(9) > apimart(1)
--   gpt-image-2-pro  (4K) → magic666(99) > apimart(1)
--
-- magic666 maps gpt-image-2-vip → gpt-image-2 upstream; the adaptor
-- converts aspect-ratio + imageSize to pixel dimensions.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Add gpt-image-2 and gpt-image-2-vip to magic666's model list.
-- ---------------------------------------------------------------------------

UPDATE channels
SET models = (
  SELECT string_agg(m, ',')
  FROM (
    SELECT unnest(string_to_array(models, ',')) AS m
    UNION
    SELECT 'gpt-image-2'
    UNION
    SELECT 'gpt-image-2-vip'
  ) AS deduped
)
WHERE name = 'magic666' AND type = 62 AND "group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 2: Add gpt-image-2-vip → gpt-image-2 to magic666's model_mapping.
-- ---------------------------------------------------------------------------

UPDATE channels
SET model_mapping = (model_mapping::jsonb || '{"gpt-image-2-vip": "gpt-image-2"}'::jsonb)::text
WHERE name = 'magic666' AND type = 62 AND "group" = 'default'
  AND NOT (model_mapping::jsonb ? 'gpt-image-2-vip');

-- ---------------------------------------------------------------------------
-- Step 3: Seed abilities for the two new model tiers.
-- ---------------------------------------------------------------------------

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group, m.model_name, c.id, true, 0, 0, 'magic666'
FROM (VALUES ('default'), ('auto')) AS g(ability_group)
CROSS JOIN (VALUES ('gpt-image-2'), ('gpt-image-2-vip')) AS m(model_name)
JOIN channels AS c
  ON c.name = 'magic666' AND c.type = 62 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = true,
    tag     = 'magic666';

COMMIT;
