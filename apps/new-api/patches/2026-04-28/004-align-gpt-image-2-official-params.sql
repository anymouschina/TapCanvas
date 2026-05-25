-- 004-align-gpt-image-2-official-params.sql
-- Purpose: 把 models.gpt-image-2-official 行的 params_def 与 capabilities
--          补齐到与 gpt-image-2 (canonical) 一致。
--
-- Background:
--   patches/2026-04-27/002-add-gpt-image-2-official.sql 里 INSERT models 时
--   只写了 model_name / description / vendor_id / kind 等，没有写 params_def。
--   于是新插入的行 params_def='', capabilities='' —— 前端 model picker 拿不到
--   尺寸/分辨率/参考图等规格选项，跟 gpt-image-2 体验不一致。
--
--   Source of truth：当前 alive 的 alias 行 model_name='gpt-image-2-apimart'
--   （由 patch 008-add-apimart-channel 写入，与 canonical gpt-image-2 同份
--   params_def）。从它那里复制是最稳的（避免把过期的 canonical 行误用）。
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent。
--        只在 -official 行的 params_def 为空时复制；非空不覆盖。
-- After: docker restart <new-api container>  以刷新 model 元数据缓存。

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 复制 params_def + capabilities：source = gpt-image-2-apimart (alive)
-- -----------------------------------------------------------------------------

UPDATE models AS dst
SET params_def   = src.params_def,
    capabilities = src.capabilities,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM (
  SELECT params_def, capabilities
  FROM models
  WHERE model_name = 'gpt-image-2-apimart'
    AND deleted_at IS NULL
    AND params_def IS NOT NULL
    AND params_def <> ''
  ORDER BY id DESC
  LIMIT 1
) AS src
WHERE dst.model_name = 'gpt-image-2-official'
  AND dst.deleted_at IS NULL
  AND (dst.params_def IS NULL OR dst.params_def = '');

-- -----------------------------------------------------------------------------
-- 验证
-- -----------------------------------------------------------------------------

\echo
\echo '----- 修复后 -official 与 -apimart 的 params_def 一致性 -----'
SELECT model_name,
       length(params_def)   AS params_len,
       length(capabilities) AS caps_len,
       md5(params_def)      AS params_md5
FROM models
WHERE model_name IN ('gpt-image-2-apimart','gpt-image-2-official')
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
