-- 011-unify-image-model-pricing.sql
-- Unified image model pricing (new values WIN via right-side jsonb merge):
--   nanobanana2 / nano-banana-fast / gpt-image-2 / gpt-image-2-all
--     / doubao-seedream-5-0-260128 : 5 credits (base 1/2k); 4k = 2× via Go ratio
--   nano-banana-pro                : 10 credits (base 1/2k, 2× banana-2)

BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{
    "nanobanana2":                    5,
    "nano-banana-fast":               5,
    "nano-banana-pro":               10,
    "gpt-image-2":                    5,
    "gpt-image-2-all":                5,
    "doubao-seedream-5-0-260128":     5
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
