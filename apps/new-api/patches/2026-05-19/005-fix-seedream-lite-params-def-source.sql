-- 005-fix-seedream-lite-params-def-source.sql
-- Purpose: 从正确来源（doubao-seedream-5-0-260128）同步 params_def 到 lite 系列。
--
-- 004 patch 从 doubao-seedream-5-0 (id=335, params_def=NULL) 复制，结果仍为 NULL。
-- 实际 params_def 数据在 doubao-seedream-5-0-260128 (id=6)。
-- buildCanonicalModelList 通过 canonicalModelAliasMap 把 -260128 后缀 merge 到
-- canonical key，因此只需给 doubao-seedream-5-0-lite-260128 设置 params_def，
-- lite 的 canonical entry 就能通过 chooseMergedParamsDef 拿到规格。

BEGIN;

UPDATE models
SET params_def = (
    SELECT params_def
    FROM models
    WHERE model_name = 'doubao-seedream-5-0-260128'
      AND deleted_at IS NULL
      AND params_def IS NOT NULL
      AND params_def <> ''
      AND params_def <> 'null'
    LIMIT 1
),
updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
    'doubao-seedream-5-0-lite',
    'doubao-seedream-5-0-lite-260128'
)
  AND deleted_at IS NULL;

COMMIT;

-- 验证：
-- SELECT model_name, LEFT(params_def, 60) AS pd
-- FROM models
-- WHERE model_name LIKE 'doubao-seedream-5-0-lite%'
--   AND deleted_at IS NULL
-- ORDER BY model_name;
