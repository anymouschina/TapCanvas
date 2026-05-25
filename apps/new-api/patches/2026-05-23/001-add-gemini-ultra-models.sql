-- 001-add-gemini-ultra-models.sql
-- Purpose: expose gemini-3-pro-image-preview-ultra and gemini-3.1-flash-image-preview-ultra
--   as public-facing model names routed exclusively through the beqlee 极速 channel.
--
-- Pricing (hardcoded in model/pricing.go, 1 点 = ¥0.1):
--   gemini-3-pro-image-preview-ultra:     1K=26pt  2K=31pt  4K=41pt
--   gemini-3.1-flash-image-preview-ultra: 1K=16pt  2K=23pt  4K=26pt
--
-- Routing:
--   *-ultra  →  beqlee-gemini channel (type=24, name='beqlee-gemini')
--   model_mapping: strip -ultra suffix → upstream real name
--
-- canonical_model.go contains identity mappings so these names are NOT
-- collapsed to the base canonical key, preserving their independent pricing.
--
-- Idempotent. PostgreSQL only.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: seed model rows ───────────────────────────────────────────────────

INSERT INTO models (
  model_name, kind, description, vendor_id,
  status, sync_official, name_rule,
  created_time, updated_time,
  capabilities, params_def
)
SELECT
  'gemini-3-pro-image-preview-ultra',
  'image',
  'Gemini 3 Pro Image — beqlee 极速渠道，更快响应',
  (SELECT id FROM vendors WHERE name = '云雾 AI' AND deleted_at IS NULL LIMIT 1),
  1, 0, 0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  '["reference_images"]',
  (SELECT params_def FROM models
   WHERE model_name = 'gemini-3-pro-image-preview' AND deleted_at IS NULL
   LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gemini-3-pro-image-preview-ultra' AND deleted_at IS NULL
);

INSERT INTO models (
  model_name, kind, description, vendor_id,
  status, sync_official, name_rule,
  created_time, updated_time,
  capabilities, params_def
)
SELECT
  'gemini-3.1-flash-image-preview-ultra',
  'image',
  'Gemini 3.1 Flash Image — beqlee 极速渠道，更快响应',
  (SELECT id FROM vendors WHERE name = '云雾 AI' AND deleted_at IS NULL LIMIT 1),
  1, 0, 0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  '["reference_images"]',
  (SELECT params_def FROM models
   WHERE model_name = 'gemini-3.1-flash-image-preview' AND deleted_at IS NULL
   LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gemini-3.1-flash-image-preview-ultra' AND deleted_at IS NULL
);

-- ── Step 2: add ultra models to beqlee channel + update model_mapping ─────────

UPDATE channels
SET
  models = models
    || ',gemini-3-pro-image-preview-ultra'
    || ',gemini-3.1-flash-image-preview-ultra',
  model_mapping = (
    COALESCE(model_mapping::jsonb, '{}'::jsonb)
    || '{"gemini-3-pro-image-preview-ultra":"gemini-3-pro-image-preview","gemini-3.1-flash-image-preview-ultra":"gemini-3.1-flash-image-preview"}'::jsonb
  )::text
WHERE name = 'beqlee-gemini' AND type = 24 AND "group" = 'default'
  AND models NOT LIKE '%gemini-3-pro-image-preview-ultra%';

-- ── Step 3: seed abilities ────────────────────────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model, c.id, true, 10, 100, 'beqlee-gemini'
FROM (VALUES
  ('gemini-3-pro-image-preview-ultra'),
  ('gemini-3.1-flash-image-preview-ultra')
) AS m(model)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'beqlee-gemini' AND c.type = 24 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = true,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Verification ──────────────────────────────────────────────────────────────

\echo '----- ultra models in DB -----'
SELECT model_name, kind, status FROM models
WHERE model_name IN (
  'gemini-3-pro-image-preview-ultra',
  'gemini-3.1-flash-image-preview-ultra'
) AND deleted_at IS NULL;

\echo '----- beqlee channel models -----'
SELECT name, LEFT(models, 120) AS models_preview, LEFT(model_mapping, 120) AS mapping_preview
FROM channels WHERE name = 'beqlee-gemini' AND type = 24;

\echo '----- abilities seeded -----'
SELECT a."group", a.model, a.enabled
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE c.name = 'beqlee-gemini' AND c.type = 24
  AND a.model LIKE '%-ultra'
ORDER BY a."group", a.model;

COMMIT;
