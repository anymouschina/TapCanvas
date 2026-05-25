-- 002-add-official-image-model-tiers.sql
-- Purpose: ensure gpt-image-2-official and gemini-3-pro-image-preview-official
--          exist in the models table as active (status=1) entries.
--
-- Background:
--   These are billing-only tiers — no channel lists them directly. They route
--   to their base models via buildModelsChain in controller/relay.go, and have
--   fixed per-resolution pricing hardcoded in pricing.go:
--     gpt-image-2-official:                1K=1.5 CNY, 2K=1.8 CNY, 4K=2.5 CNY
--     gemini-3-pro-image-preview-official: 1K=1.5 CNY, 2K=1.8 CNY, 4K=2.5 CNY
--
--   canonical_model.go contains identity mappings that prevent the "-official"
--   suffix from being stripped to the base model key.
--
-- Idempotent: only inserts when no active (deleted_at IS NULL) row exists.

BEGIN;

INSERT INTO models (
  model_name, kind, description, vendor_id,
  status, sync_official, name_rule,
  created_time, updated_time,
  params_def
)
SELECT
  'gpt-image-2-official',
  'image',
  'upstream gpt-image-2',
  (SELECT id FROM vendors WHERE name = 'APIMart AI'),
  1, 0, 0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  '[{"key":"size","type":"enum","label":"宽高比","default":"auto","options":[{"value":"auto","label":"自动"},{"value":"1:1","label":"1:1"},{"value":"16:9","label":"16:9 横"},{"value":"9:16","label":"9:16 竖"},{"value":"3:2","label":"3:2 横"},{"value":"2:3","label":"2:3 竖"}]},{"key":"image_size","type":"enum","label":"分辨率","default":"1K","options":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K","whenSelected":{"aspectRatioOptions":["16:9","9:16"]}}]},{"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request","description":"可选，用于图生图的参考图 URL 列表"}]'
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gpt-image-2-official' AND deleted_at IS NULL
);

INSERT INTO models (
  model_name, kind, description, vendor_id,
  status, sync_official, name_rule,
  created_time, updated_time,
  params_def
)
SELECT
  'gemini-3-pro-image-preview-official',
  'image',
  'APIMart official-priced alias for upstream gemini-3-pro-image-preview',
  (SELECT id FROM vendors WHERE name = 'APIMart AI'),
  1, 0, 0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  '[{"key":"size","type":"enum","label":"宽高比","default":"1:1","options":[{"value":"1:1","label":"1:1"},{"value":"16:9","label":"16:9 横"},{"value":"9:16","label":"9:16 竖"},{"value":"4:3","label":"4:3"},{"value":"3:4","label":"3:4"}]},{"key":"image_size","type":"enum","label":"分辨率","default":"1K","options":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},{"key":"urls","type":"array","item_type":"string","label":"参考图 URL","scope":"per_request","description":"可选，图生图参考图 URL 列表"}]'
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gemini-3-pro-image-preview-official' AND deleted_at IS NULL
);

COMMIT;
