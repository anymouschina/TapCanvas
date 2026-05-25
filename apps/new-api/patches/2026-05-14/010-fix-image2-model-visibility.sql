-- =============================================================
-- Patch: 2026-05-14/010-fix-image2-model-visibility
-- 修复 gpt-image-2 和 gpt-image-2-official 可见性（status=1）。
--
-- 背景：
--   - gpt-image-2（canonical）：live 行 status=0，导致不出现在 8788 目录。
--   - gpt-image-2-official：APIMart 独立模型，status=0，同样缺失。
--     该模型不是渠道别名，是 APIMart 对外独立提供的 SKU，应保留原名可见。
--
-- 设计原则（不再做后缀去除）：
--   模型 key 保持原名，多个渠道可直接在 abilities 表中绑定同一 model key；
--   不再为每个渠道创建带后缀的 alias model。
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

UPDATE models
SET status       = 1,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('gpt-image-2', 'gpt-image-2-official')
  AND deleted_at IS NULL
  AND status <> 1;

\echo '----- gpt-image-2 系列可见模型 -----'
SELECT model_name, status FROM models
WHERE model_name IN ('gpt-image-2', 'gpt-image-2-official')
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
