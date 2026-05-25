-- 006-fix-gpt-image-2-vendor-and-pricing.sql
-- Purpose: (1) fix gpt-image-2 vendor from 云雾 AI → OpenAI;
--          (2) seed ModelPrice for all image/video models;
--          (3) seed ModelRatio / CompletionRatio for all chat models;
--          so that every model that has a channel/ability can be used without
--          falling back to the expensive 37.5 default ratio.
-- Pricing notes:
--   gpt-image-2 = 4 × gemini-3.1-flash-image-preview (nanobanana2).
--   ModelPrice unit: USD per image/video call.
--   ModelRatio unit: ratio where 1.0 ≡ $2/1M input tokens (gpt-4.1 baseline).
--   CompletionRatio: multiplier on top of ModelRatio for output tokens.
-- Scope: PostgreSQL only, data-only, idempotent execution required.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Upsert OpenAI vendor.
-- -----------------------------------------------------------------------------

WITH vendor_seed(name, description, icon, status) AS (
  VALUES
    ('OpenAI', 'OpenAI official models', NULL, 1)
)
INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT
  s.name, s.description, s.icon, s.status,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM vendors AS v
  WHERE v.name = s.name AND v.deleted_at IS NULL
);

WITH vendor_seed(name, description, icon, status) AS (
  VALUES
    ('OpenAI', 'OpenAI official models', NULL, 1)
)
UPDATE vendors AS target
SET
  description = src.description,
  status      = src.status,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS src
WHERE target.name = src.name AND target.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 2: Fix gpt-image-2 vendor → OpenAI + correct description.
-- -----------------------------------------------------------------------------

UPDATE models AS target
SET
  vendor_id    = v.id,
  description  = 'OpenAI image generation gpt-image-2 — served via comfly proxy',
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM vendors AS v
WHERE v.name = 'OpenAI'
  AND v.deleted_at IS NULL
  AND target.model_name = 'gpt-image-2'
  AND target.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 3: Seed ModelPrice for image and video models.
-- Merge strategy: existing DB values take priority (EXCLUDED || options).
-- Pricing:
--   nanobanana2  (gemini-3.1-flash-image-preview via yunwu) : $0.01/image
--   nano-banana-fast (gemini-2.5-flash-image via yunwu)    : $0.01/image
--   nano-banana-pro  (gemini-3-pro-image-preview via yunwu): $0.04/image
--   gpt-image-2  (OpenAI via comfly, 4× nanobanana2)       : $0.04/image
--   doubao-seedream-5-0-260128 (ByteDance DALL-E equiv)    : $0.04/image
--   kling-v3     (video, standard 5-10s)                   : $0.14/video
--   kling-video-o1 (video, pro quality)                    : $0.14/video
--   veo3.1-pro / veo_3_1 (Google Veo 3.1 Pro)              : $0.40/video
--   veo_3_1-fast (Google Veo 3.1 Fast)                     : $0.15/video
--   veo_3_1_i2v_s_fast_fl_landscape (image-to-video fast)  : $0.15/video
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{
    "nanobanana2": 0.01,
    "nano-banana-fast": 0.01,
    "nano-banana-pro": 0.04,
    "gpt-image-2": 0.04,
    "doubao-seedream-5-0-260128": 0.04,
    "kling-v3": 0.14,
    "kling-video-o1": 0.14,
    "veo3.1-pro": 0.40,
    "veo_3_1": 0.40,
    "veo_3_1-fast": 0.15,
    "veo_3_1_i2v_s_fast_fl_landscape": 0.15
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

-- -----------------------------------------------------------------------------
-- Step 4: Seed ModelRatio for chat / multimodal models.
-- Merge strategy: same as above (existing values win for duplicate keys).
-- Pricing:
--   deepseek-v3.2          (DeepSeek V3.2 via yunwu): ratio 0.8  → $1.6/1M input
--   gemini-3.1-pro-preview (Gemini 3.1 Pro via yunwu): ratio 0.625 → $1.25/1M input
--   gemini-3-flash-preview (Gemini 3 Flash via yunwu): ratio 0.075 → $0.15/1M input
--   gpt-5.4                (GPT-5.4 via yunwu)       : ratio 0.625 → $1.25/1M input
-- Note: gpt-image-2 / nano-banana models use ModelPrice, not ModelRatio.
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value)
VALUES (
  'ModelRatio',
  '{
    "deepseek-v3.2": 0.8,
    "gemini-3.1-pro-preview": 0.625,
    "gemini-3-flash-preview": 0.075,
    "gpt-5.4": 0.625
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

-- -----------------------------------------------------------------------------
-- Step 5: Seed CompletionRatio for models with non-default output pricing.
-- Merge strategy: same.
-- Ratios (output / input):
--   deepseek-v3.2          : 4.0  (official DeepSeek V3 output ≈ 4× input)
--   gemini-3.1-pro-preview : 8.0  (pro tier: $10 output / $1.25 input = 8×)
--   gemini-3-flash-preview : 4.0  (flash tier, overrides hardcoded 4 fallback)
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value)
VALUES (
  'CompletionRatio',
  '{
    "deepseek-v3.2": 4.0,
    "gemini-3.1-pro-preview": 8.0,
    "gemini-3-flash-preview": 4.0
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
