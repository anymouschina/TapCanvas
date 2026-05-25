-- 010-update-model-price-credits.sql
-- Sync ModelPrice to match tapcanvas pricing (1 ModelPrice unit = 1 credit = ¥0.1)
-- New values WIN over existing via (options.value::jsonb || EXCLUDED.value::jsonb)
-- Idempotent.

BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{
    "veo_3_1":                        55,
    "veo3.1-pro":                     55,
    "veo_3_1-fast":                   13,
    "veo_3_1_i2v_s_fast_fl_landscape": 13,
    "kling-v3":                       14,
    "kling-video-o1":                 14,
    "gpt-image-2":                     4,
    "gpt-image-2-all":                 4,
    "nanobanana2":                     4,
    "nano-banana-pro":                 7,
    "nano-banana-fast":                3,
    "gemini-3.1-flash-image-preview":  4,
    "gemini-3-pro-image-preview":      7,
    "gemini-2.5-flash-image":          3,
    "doubao-seedream-5-0-260128":      4,
    "doubao-seedance-2-0-260128":     10,
    "doubao-seedance-2-0-fast-260128":  8
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
