-- 002-sync-model-price-to-credit-pricing.sql
-- Purpose: align new-api ModelPrice with TapCanvas credit pricing so
--          /api/pricing fallback matches the actual "credits per call"
--          contract when clients compute credits as ceil(model_price * 10).
--
-- Pricing unit:
--   1 credit = $0.1
--   therefore N credits => ModelPrice = N / 10
--
-- Scope:
--   1. Fix flat per-call image/video models that were previously stored as
--      credit integers or placeholder USD values, causing 10x fallback
--      inflation in pricing consumers.
--   2. Document the intended linear pricing policy for Seedance 2.0 / Fast.
--
-- Important:
--   new-api currently persists ModelPrice as a single scalar per model.
--   Seedance's resolution + duration linear pricing cannot be enforced by SQL
--   alone yet. The formulas are documented below, but NOT written into
--   ModelPrice in this patch to avoid creating false runtime pricing.
--
-- Intended Seedance runtime formulas (not applied by this SQL):
--   - Seedance 2.0 480p:      ceil(duration_seconds * 12) credits
--   - Seedance 2.0 720p:      ceil(duration_seconds * 16) credits
--   - Seedance 2.0 Fast 480p: ceil(duration_seconds * 10) credits
--   - Seedance 2.0 Fast 720p: ceil(duration_seconds * 14) credits
--
-- Idempotent: right-side jsonb merge wins.

BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  $json${
    "gemini-3.1-flash-image-preview": 0.30,
    "gemini-3.1-flash-image-preview-apimart": 0.30,

    "gpt-image-2": 0.40,
    "gpt-image-2-all": 0.40,
    "gpt-image-2-apimart": 0.40,
    "gpt-image-2-suchuang": 0.40,

    "gemini-3-pro-image-preview": 0.70,
    "gemini-3-pro-image-preview-apimart": 0.70,

    "doubao-seedream-5-0-260128": 0.40,

    "nano-banana-fast": 0.30,
    "nano-banana-fast-suchuang": 0.30,
    "nano-banana-pro": 0.70,
    "nano-banana-pro-suchuang": 0.70,
    "nanobanana2": 0.40,
    "nanobanana2-suchuang": 0.40,

    "kling-v3": 1.40,
    "kling-v3-apimart": 1.40,

    "veo3.1-fast": 1.30,
    "veo3.1-fast-apimart": 1.30,
    "veo3.1-fast-suchuang": 1.30,
    "veo_3_1-fast": 1.30,
    "veo_3_1_i2v_s_fast_fl_landscape": 1.30,

    "veo3.1-pro": 5.50,
    "veo3.1-pro-suchuang": 5.50,
    "veo_3_1": 5.50
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
