-- 002-gemini-image-cny-premium-pricing.sql
-- Purpose: align port-4455 new-api ModelPrice for the three apimart Gemini
--          image models with the product CNY price. Per-resolution image specs
--          are emitted by model/pricing.go as param_pricing (see
--          fixedImagePricingRules cases added alongside this patch).
--
-- Pricing source (apimart current USD per image):
--   gemini-2.5-flash-image-preview : flat $0.0125  (no resolution tier)
--   gemini-3-pro-image-preview     : 1K/2K $0.04, 4K $0.05
--   gemini-3.1-flash-image-preview : 1K $0.03, 2K $0.04, 4K $0.06
--                                    (apimart 0.5K tier exists but is not
--                                     selectable upstream, so pricing.go only
--                                     emits the user-selectable 1K/2K/4K)
--
-- Rule requested by product:
--   new_api_price_cny = apimart_current_price_usd * 7.3 * 1.6
--   hono_api_credits  = ceil(new_api_price_cny * 10)
--
-- ModelPrice scalar = minimum CNY across resolution tiers (matches the base
-- price exposed by fixedImageBasePriceCNY):
--   gemini-2.5-flash-image-preview : 0.0125 * 11.68 = 0.146000 CNY
--   gemini-3-pro-image-preview     : 0.04   * 11.68 = 0.467200 CNY
--   gemini-3.1-flash-image-preview : 0.03   * 11.68 = 0.350400 CNY
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.
-- After applying: restart new-api or wait for the one-minute pricing cache to expire.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  $json${
    "gemini-2.5-flash-image-preview": 0.146,
    "gemini-2.5-flash-image-preview-apimart": 0.146,
    "gemini-3-pro-image-preview": 0.4672,
    "gemini-3-pro-image-preview-apimart": 0.4672,
    "gemini-3.1-flash-image-preview": 0.3504,
    "gemini-3.1-flash-image-preview-apimart": 0.3504
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb)
  || EXCLUDED.value::jsonb
)::text;

\echo
\echo '----- gemini image CNY premium ModelPrice after patch -----'
SELECT
  key,
  value::jsonb -> 'gemini-2.5-flash-image-preview'         AS gemini_25_flash_image,
  value::jsonb -> 'gemini-2.5-flash-image-preview-apimart' AS gemini_25_flash_image_apimart,
  value::jsonb -> 'gemini-3-pro-image-preview'             AS gemini_3_pro_image,
  value::jsonb -> 'gemini-3-pro-image-preview-apimart'     AS gemini_3_pro_image_apimart,
  value::jsonb -> 'gemini-3.1-flash-image-preview'         AS gemini_31_flash_image,
  value::jsonb -> 'gemini-3.1-flash-image-preview-apimart' AS gemini_31_flash_image_apimart
FROM options
WHERE key = 'ModelPrice';

COMMIT;
