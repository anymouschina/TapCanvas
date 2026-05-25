-- =============================================================
-- Patch: 2026-05-14/008-fix-gpt55-pricing
-- 强制覆盖 gpt-5.5 定价：取渠道最高成本（rc $2/M）× 1.5 加价。
--
-- 目标定价：
--   input    $3/M  → ModelRatio       = 1.5  (= 3 / 2)
--   output   $18/M → CompletionRatio  = 6.0  (= 18 / 3)
--   cache rd $0/M  → CacheRatio       = 0.0  (免费)
--   cache wr $0.3/M→ CreateCacheRatio = 0.1  (= 0.3 / 3)
--
-- 注：使用 new_value || existing_value 顺序（新值优先），强制覆盖已有条目。
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

-- ModelRatio: 新值优先（覆盖现有 gpt-5.5 条目）
INSERT INTO options (key, value)
VALUES ('ModelRatio', '{"gpt-5.5": 1.5}')
ON CONFLICT (key) DO UPDATE
  SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

-- CompletionRatio
INSERT INTO options (key, value)
VALUES ('CompletionRatio', '{"gpt-5.5": 6.0}')
ON CONFLICT (key) DO UPDATE
  SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

-- CacheRatio: 强制归零（cache read 免费）
INSERT INTO options (key, value)
VALUES ('CacheRatio', '{"gpt-5.5": 0.0}')
ON CONFLICT (key) DO UPDATE
  SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

-- CreateCacheRatio: $0.3/M write / $3/M input = 0.1
INSERT INTO options (key, value)
VALUES ('CreateCacheRatio', '{"gpt-5.5": 0.1}')
ON CONFLICT (key) DO UPDATE
  SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

-- 验证
\echo '----- gpt-5.5 定价（覆盖后）-----'
SELECT key, value::jsonb -> 'gpt-5.5' AS val
FROM options
WHERE key IN ('ModelRatio', 'CompletionRatio', 'CacheRatio', 'CreateCacheRatio')
ORDER BY key;

COMMIT;
