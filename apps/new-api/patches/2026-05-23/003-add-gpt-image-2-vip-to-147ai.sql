-- 003-add-gpt-image-2-vip-to-147ai.sql
-- Purpose: expose gpt-image-2-vip on the 147ai channel so that 2K resolution
--   requests can satisfy the tier-model routing requirement.
--
-- Background:
--   selectChannelBoundImageTierModel requires a rank-2 (vip) or rank-3 (pro)
--   model in the channel's model list for 2K/4K requests. The 147ai channel
--   only had gpt-image-2 (rank 1) and gpt-image-2-147ai (rank 1), causing
--   "gpt-image-2 4K request requires a real tier model" errors.
--
-- Fix: add gpt-image-2-vip to the 147ai channel and map it to gpt-image-2-147ai
--   (their actual upstream endpoint). gpt-image-2-vip has tier rank 2 and shares
--   the same pricing as gpt-image-2 (fixedImagePricingRules handles both together).
--
-- Idempotent. PostgreSQL only.

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET
  models = models || ',gpt-image-2-vip',
  model_mapping = (
    COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
    || '{"gpt-image-2-vip": "gpt-image-2-147ai"}'::jsonb
  )::text
WHERE tag = '147ai'
  AND models NOT LIKE '%gpt-image-2-vip%';

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, 'gpt-image-2-vip', c.id, true, 0, 0, '147ai'
FROM (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c ON c.tag = '147ai'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

\echo '----- 147ai channel after patch -----'
SELECT name, LEFT(models, 120) AS models_preview, LEFT(model_mapping, 120) AS mapping_preview
FROM channels WHERE tag = '147ai';

\echo '----- gpt-image-2-vip abilities on 147ai -----'
SELECT a."group", a.model, a.enabled
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE c.tag = '147ai' AND a.model = 'gpt-image-2-vip';

COMMIT;
