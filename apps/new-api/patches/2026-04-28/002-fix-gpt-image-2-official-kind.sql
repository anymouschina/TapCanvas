-- 002-fix-gpt-image-2-official-kind.sql
-- Purpose: 把 models 表中 model_name='gpt-image-2-official' 行的空 kind 修回 'image'。
--
-- Background:
--   patches/2026-04-27/002-add-gpt-image-2-official.sql 原本 INSERT 时显式写了
--   kind='image'。后续 admin UI 走 Model.Update() 时 Select 列表里包含 "kind"，
--   payload 没带 kind 字段会被反序列化成空串后再写回，把 'image' 覆盖成 ''。
--   于是 hono-api `mapListItem` 兜底链落到 normalizeKindFromEndpoints(["openai"])
--   返回默认 'text'，前端就把图模显示成文本模型。
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent。
--        只动 model_name 精确匹配的行，不动其他 model。
-- After: docker restart <new-api container>  以刷新 model 元数据缓存。

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 修复主目标：gpt-image-2-official
-- -----------------------------------------------------------------------------

UPDATE models
SET kind = 'image',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gpt-image-2-official'
  AND (kind IS NULL OR kind = '')
  AND deleted_at IS NULL;

-- 同时修一下别名行（如果存在）：apimart 后缀变体也是 image
UPDATE models
SET kind = 'image',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
        'gpt-image-2-official-apimart'
      )
  AND (kind IS NULL OR kind = '')
  AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 验证（commit 前肉眼对一下）
-- -----------------------------------------------------------------------------

\echo
\echo '----- 修复后所有 gpt-image-2-official* 行 -----'
SELECT id, model_name, kind, status,
       to_char(to_timestamp(updated_time), 'YYYY-MM-DD HH24:MI:SS') AS updated_at
FROM models
WHERE model_name LIKE 'gpt-image-2-official%'
  AND deleted_at IS NULL
ORDER BY id;

COMMIT;
