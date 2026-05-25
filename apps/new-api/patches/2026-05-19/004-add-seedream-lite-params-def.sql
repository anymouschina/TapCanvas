-- 004-add-seedream-lite-params-def.sql
-- Purpose: 补全 doubao-seedream-5-0-lite 的 params_def，与标准版一致。
--
-- 002 patch 注册了 lite 模型但未设置 params_def，
-- 导致 /api/models/list 返回时 lite 没有规格信息（imageSizeOptions 等为空）。
-- 标准版 (doubao-seedream-5-0) 已有完整 params_def，此 patch 将其同步到 lite。

BEGIN;

UPDATE models
SET params_def = (
    SELECT params_def
    FROM models
    WHERE model_name = 'doubao-seedream-5-0'
      AND deleted_at IS NULL
    LIMIT 1
),
updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
    'doubao-seedream-5-0-lite',
    'doubao-seedream-5-0-lite-260128'
)
  AND deleted_at IS NULL
  AND (params_def IS NULL OR params_def = '' OR params_def = 'null');

COMMIT;

-- 验证：
-- SELECT model_name, params_def
-- FROM models
-- WHERE model_name LIKE 'doubao-seedream%'
--   AND deleted_at IS NULL
-- ORDER BY model_name;
