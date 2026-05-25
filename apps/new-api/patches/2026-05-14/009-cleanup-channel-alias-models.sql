-- =============================================================
-- Patch: 2026-05-14/009-cleanup-channel-alias-models
-- 软删除渠道别名模型记录（管理 UI 清洁化）。
--
-- 背景：早期每个渠道创建了带渠道后缀的 model alias
--   (gpt-image-2-rightcodes, gpt-image-2-apimart, gpt-image-2-suchuang 等)，
--   实际上多个渠道可以直接服务同一个 canonical model key，
--   channel alias 是多余设计，现统一软删除。
--
-- 已在 patch 006 中 status=0 + abilities disabled；
-- 本 patch 进一步 soft-delete（deleted_at），使 admin UI 彻底不显示。
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

UPDATE models
SET deleted_at   = NOW(),
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
  'gpt-image-2-rightcodes',
  'gpt-image-2-apimart',
  'gpt-image-2-suchuang',
  'gpt-image-2-all'
)
  AND deleted_at IS NULL;

-- 验证：这些别名应全部消失（0 rows）
\echo '----- 存活的 gpt-image-2 channel alias（应为 0 行）-----'
SELECT model_name, status, deleted_at FROM models
WHERE model_name IN (
  'gpt-image-2-rightcodes',
  'gpt-image-2-apimart',
  'gpt-image-2-suchuang',
  'gpt-image-2-all'
)
  AND deleted_at IS NULL;

-- 验证：剩余可见的 gpt-image-2 系列模型
\echo '----- 存活的 gpt-image-2 系列模型 -----'
SELECT model_name, status FROM models
WHERE model_name LIKE 'gpt-image-2%' AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
