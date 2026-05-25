-- 004-magic666-gpt-image-2-pro-mapping.sql
-- Purpose:
--   1. magic666 渠道的 model_mapping 加入 "gpt-image-2" -> "gpt-image-2-pro"：
--      外部调用方只看到 gpt-image-2，当能力表权重指向 magic666 时，
--      上游自动换成 gpt-image-2-pro。
--   2. 隐藏 gpt-image-2-pro（new-api models 表 status=0），对外不暴露。
--
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: 在 magic666 channel 的 model_mapping 追加 gpt-image-2 -> gpt-image-2-pro
-- ---------------------------------------------------------------------------

UPDATE channels
SET model_mapping = (
      COALESCE(model_mapping::jsonb, '{}'::jsonb)
      || '{"gpt-image-2": "gpt-image-2-pro"}'::jsonb
    )::text
WHERE name = 'magic666' AND type = 62 AND "group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 2: 隐藏 gpt-image-2-pro（status=0）
-- ---------------------------------------------------------------------------

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('gpt-image-2-pro', 'gpt-image-2-pro-magic666')
  AND deleted_at IS NULL;

COMMIT;
