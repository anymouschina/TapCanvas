-- 007-fix-image-model-pricing-keys.sql
-- Patch 006 seeded ModelPrice with alias keys (nanobanana2, nano-banana-fast,
-- nano-banana-pro) that don't match the actual model_name values in the models
-- table. This patch adds the correct model_name keys so the per-image price
-- is applied instead of falling back to the 37.5 default ratio.
--
-- Merge strategy: existing DB values take priority (EXCLUDED || options.value).
-- Idempotent.

BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{
    "gemini-3.1-flash-image-preview": 0.01,
    "gemini-2.5-flash-image":         0.01,
    "gemini-3-pro-image-preview":      0.04
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
