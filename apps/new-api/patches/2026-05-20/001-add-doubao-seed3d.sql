-- 001-add-doubao-seed3d.sql
-- Purpose: 注册 doubao-seed3d-2-0-260328（3D 生成）到 ark-doubao-image 渠道。
--
-- API:  POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks  (异步 task)
-- Channel type: 45 (VolcEngine) — 任务 relay 也走 taskdoubao.TaskAdaptor
-- Channel name: ark-doubao-image (已存在)
--
-- 官方定价：暂无公开信息，先按 ¥0.5/次（与图片模型对齐，后续可调）。
-- Idempotent: 全部幂等，可重复执行。

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: 注册模型（kind='image' 表示输入图片，输出 3D 资产）
-- ---------------------------------------------------------------------------

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'doubao-seed3d-2-0-260328',
  'Doubao Seed3D 2.0 — 图生 3D 模型（ARK 异步 Task API）',
  NULL, NULL,
  v.id,
  NULL, 'image', 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM vendors v
WHERE v.name = 'ByteDance ARK' AND v.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM models WHERE model_name = 'doubao-seed3d-2-0-260328' AND deleted_at IS NULL
  )
LIMIT 1;

-- 若已存在则确保启用
UPDATE models
SET kind         = 'image',
    status       = 1,
    deleted_at   = NULL,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seed3d-2-0-260328';

-- ---------------------------------------------------------------------------
-- Step 2: 将模型追加到 ark-doubao-image 渠道的 models 列表
-- ---------------------------------------------------------------------------

UPDATE channels
SET models = CASE
               WHEN models LIKE '%doubao-seed3d-2-0-260328%' THEN models
               ELSE models || ',doubao-seed3d-2-0-260328'
             END
WHERE name = 'ark-doubao-image' AND type = 45 AND "group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 3: 注册 abilities
-- ---------------------------------------------------------------------------

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  g.ability_group,
  'doubao-seed3d-2-0-260328',
  c.id,
  true,
  10,
  100,
  'ark-doubao-image'
FROM (VALUES ('default'), ('auto')) AS g(ability_group)
JOIN channels c ON c.name = 'ark-doubao-image' AND c.type = 45 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 4: ModelPrice（¥/次，quotaType=1 fixed-price）
-- 官方定价 ¥5/次。
-- ---------------------------------------------------------------------------

UPDATE options
SET value = (value::jsonb || '{"doubao-seed3d-2-0-260328":5}'::jsonb)::text
WHERE key = 'ModelPrice';

-- 若 ModelPrice 行不存在则新建（初始化场景）
INSERT INTO options (key, value)
VALUES ('ModelPrice', '{"doubao-seed3d-2-0-260328":5}')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- 验证：
-- SELECT ability_group, model, c.name, c.type
-- FROM abilities a JOIN channels c ON c.id = a.channel_id
-- WHERE a.model = 'doubao-seed3d-2-0-260328';
--
-- SELECT value::jsonb->'doubao-seed3d-2-0-260328' FROM options WHERE key='ModelPrice';
