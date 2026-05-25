-- 001-gpt-image-2-cny-premium-pricing.sql
-- Purpose: adjust port-4455 new-api ModelPrice for gpt-image-2 variants to the
--          product CNY price. Per-resolution/per-quality image specs are emitted
--          by model/pricing.go as param_pricing.
--
-- Pricing source:
--   https://apimart.ai/zh/model/gpt-image-2
--
-- Rule requested by product:
--   new_api_price_cny = apimart_current_price_usd * 7.3 * 1.6
--   hono_api_credits  = ceil(new_api_price_cny * 10)
--
-- Base ModelPrice values:
--   gpt-image-2          1K current $0.006  -> 0.070080 CNY
--   gpt-image-2-official lowest current $0.0036 -> 0.042048 CNY
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.
-- After applying: restart new-api or wait for the one-minute pricing cache to expire.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  $json${
    "gpt-image-2": 0.07008,
    "gpt-image-2-apimart": 0.07008,
    "gpt-image-2-official": 0.042048,
    "gpt-image-2-official-apimart": 0.042048
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb)
  || EXCLUDED.value::jsonb
)::text;

\echo
\echo '----- gpt-image-2 CNY premium ModelPrice after patch -----'
SELECT
  key,
  value::jsonb -> 'gpt-image-2' AS gpt_image_2,
  value::jsonb -> 'gpt-image-2-apimart' AS gpt_image_2_apimart,
  value::jsonb -> 'gpt-image-2-official' AS gpt_image_2_official,
  value::jsonb -> 'gpt-image-2-official-apimart' AS gpt_image_2_official_apimart
FROM options
WHERE key = 'ModelPrice';

COMMIT;
