-- 002-update-image-model-prices.sql
-- Purpose: sync ModelPrice scalars (used for pre-consumption estimation) with
--   the new per-image CNY pricing defined in model/pricing.go fixedImagePricingRules.
--
-- ModelPrice scalar = lowest resolution tier CNY price (= 1K price).
-- 1 point = ¥0.1 CNY. New pricing:
--   gemini-3-pro-image-preview         : ¥0.7  (was ¥0.4672)
--   gemini-3.1-flash-image-preview      : ¥0.6  (was ¥0.3504)
--   gpt-image-2 / gpt-image-2-vip      : ¥0.2  (was ¥0.07008)
--   gemini-3-pro-image-preview-ultra   : ¥2.6  (new, beqlee 极速)
--   gemini-3.1-flash-image-preview-ultra: ¥1.6  (new, beqlee 极速)
--
-- Idempotent. PostgreSQL only.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  $json${
    "gemini-3-pro-image-preview":          0.7,
    "gemini-3-pro-image-preview-apimart":  0.7,
    "gemini-3.1-flash-image-preview":      0.6,
    "gemini-3.1-flash-image-preview-apimart": 0.6,
    "gpt-image-2":                         0.2,
    "gpt-image-2-vip":                     0.2,
    "gemini-3-pro-image-preview-ultra":    2.6,
    "gemini-3.1-flash-image-preview-ultra": 1.6
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb)
  || EXCLUDED.value::jsonb
)::text;

\echo '----- image ModelPrice after patch -----'
SELECT
  value::jsonb -> 'gemini-3-pro-image-preview'             AS pro,
  value::jsonb -> 'gemini-3-pro-image-preview-apimart'     AS pro_apimart,
  value::jsonb -> 'gemini-3.1-flash-image-preview'         AS flash,
  value::jsonb -> 'gemini-3.1-flash-image-preview-apimart' AS flash_apimart,
  value::jsonb -> 'gpt-image-2'                            AS gpt_image_2,
  value::jsonb -> 'gemini-3-pro-image-preview-ultra'       AS pro_ultra,
  value::jsonb -> 'gemini-3.1-flash-image-preview-ultra'   AS flash_ultra
FROM options
WHERE key = 'ModelPrice';

COMMIT;
