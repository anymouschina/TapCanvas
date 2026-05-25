-- 005-magic666-hide-alias-models.sql
-- 隐藏所有 -magic666 后缀别名模型，对外只暴露真实模型名。

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name LIKE '%-magic666'
  AND deleted_at IS NULL;
