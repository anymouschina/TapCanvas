-- =============================================================
-- Patch: 2026-05-14/005-register-gpt-image-2-canonical-model
-- 在 new-api models 表注册 gpt-image-2 主模型记录（status=1）。
--
-- 背景：
--   历史上 gpt-image-2 只在 abilities 表路由，models 表无记录。
--   patch 004 将 gpt-image-2-rightcodes 设为 status=0（隐藏后缀），
--   导致 /new-api-models 接口中 gpt-image-2 完全消失。
--   本 patch 补充主模型记录，使其重新出现在对外目录中，
--   同时由 abilities 透明路由到 apimart / rightcodes 双渠道。
--
-- vendor：APIMart AI（id=4），因 RightCodes 尚未加入 model_catalog_vendors。
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'gpt-image-2',
  'OpenAI GPT Image 2',
  NULL, NULL,
  v.id,
  NULL,
  'image',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM (SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'gpt-image-2' AND deleted_at IS NULL
);

-- 确保已有记录也是 enabled
UPDATE models
SET status       = 1,
    kind         = 'image',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-image-2' AND deleted_at IS NULL AND status != 1;

\echo '----- gpt-image-2 主模型 -----'
SELECT id, model_name, kind, status FROM models
WHERE model_name = 'gpt-image-2' AND deleted_at IS NULL;

COMMIT;
