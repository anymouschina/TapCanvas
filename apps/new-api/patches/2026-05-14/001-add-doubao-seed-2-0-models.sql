-- 001-add-doubao-seed-2-0-models.sql
-- Purpose: 注册 doubao-seed-2.0-{pro,lite,mini} 的定价到 options 表。
--
-- Background:
--   火山方舟 Responses API 支持 input_video（视频理解），doubao-seed-2.0 是
--   主力多模态模型。abilities 由 sync-new-api-channels.mjs 自动写入，
--   本 patch 只负责 new-api options 表中的定价数据。
--
-- Pricing ($ = ¥, ×1.2 溢价, [0,32]K 档):
--   model_ratio = price_元/M × 0.6（即 / 1000 × USD × 1.2，USD=500）
--   pro:  3.2 × 0.6 = 1.92，completion=5
--   lite: 0.6 × 0.6 = 0.36，completion=6
--   mini: 0.2 × 0.6 = 0.12，completion=10
--   cache_input / input = 0.2（三个型号一致）
--
-- Idempotent: INSERT ON CONFLICT DO UPDATE（jsonb merge）。
-- Scope: tapcanvas_new_api 库（new-api DB），data-only。

\set ON_ERROR_STOP on

BEGIN;

-- ── ModelRatio ────────────────────────────────────────────────────────────────

INSERT INTO options (key, value)
VALUES (
  'ModelRatio',
  '{
    "doubao-seed-2-0-pro-260428":  1.92,
    "doubao-seed-2.0-pro":         1.92,
    "doubao-seed-2-0-lite-260428": 0.36,
    "doubao-seed-2-0-lite-260215": 0.36,
    "doubao-seed-2.0-lite":        0.36,
    "doubao-seed-2-0-mini-260428": 0.12,
    "doubao-seed-2.0-mini":        0.12
  }'
)
ON CONFLICT (key) DO UPDATE
  SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

-- ── CompletionRatio ───────────────────────────────────────────────────────────

INSERT INTO options (key, value)
VALUES (
  'CompletionRatio',
  '{
    "doubao-seed-2-0-pro-260428":  5,
    "doubao-seed-2.0-pro":         5,
    "doubao-seed-2-0-lite-260428": 6,
    "doubao-seed-2-0-lite-260215": 6,
    "doubao-seed-2.0-lite":        6,
    "doubao-seed-2-0-mini-260428": 10,
    "doubao-seed-2.0-mini":        10
  }'
)
ON CONFLICT (key) DO UPDATE
  SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

-- ── CacheRatio ────────────────────────────────────────────────────────────────

INSERT INTO options (key, value)
VALUES (
  'CacheRatio',
  '{
    "doubao-seed-2-0-pro-260428":  0.2,
    "doubao-seed-2.0-pro":         0.2,
    "doubao-seed-2-0-lite-260428": 0.2,
    "doubao-seed-2-0-lite-260215": 0.2,
    "doubao-seed-2.0-lite":        0.2,
    "doubao-seed-2-0-mini-260428": 0.2,
    "doubao-seed-2.0-mini":        0.2
  }'
)
ON CONFLICT (key) DO UPDATE
  SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
