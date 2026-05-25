-- 001-fix-seedance-face-channel-id.sql
-- Purpose: 修复 patches/2026-04-26/001-add-seedance-face-models.sql 留下的孤儿
--          abilities 与 apimart channel.models / model_mapping 漏配。
--
-- Background:
--   原 patch 把 channel_id 写死为 9（写 patch 时本地环境的 apimart id），
--   线上 apimart 的真实 id 是 39（auto-increment 因历史 channel 删除/重建产生跳号）。
--   导致：
--     1. abilities 8 行 doubao-seedance-2.0%face% 的 channel_id 全部指向不存在的 9（孤儿）
--     2. UPDATE channels WHERE id=9 影响 0 行 → channel.models 没追加 face 系列
--     3. UPDATE channels WHERE id=9 影响 0 行 → channel.model_mapping 没追加 -apimart 别名
--
-- Fix strategy:
--   全部按 name='apimart' AND type=59 解析真实 channel id，与环境无关。幂等。
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.
-- After: docker restart <new-api container>  以刷新 channel/ability 内存缓存。

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: 把孤儿 abilities（FK 指向不存在的 channel）迁到 apimart 真实 id。
--         同时把所有 face 系列 abilities 强制指向 apimart 真实 id，覆盖任何
--         残留的 channel_id=9 写死值。
-- -----------------------------------------------------------------------------

WITH apimart AS (
  SELECT id FROM channels WHERE name = 'apimart' AND type = 59 LIMIT 1
),
moved AS (
  UPDATE abilities a
  SET channel_id = apimart.id, tag = 'apimart'
  FROM apimart
  WHERE a.model LIKE 'doubao-seedance-2.0%face%'
    AND a.channel_id <> apimart.id
    AND NOT EXISTS (
      -- 避免 ("group", model, channel_id) 唯一键冲突：仅当目标行不存在时迁移
      SELECT 1 FROM abilities b
      WHERE b."group" = a."group"
        AND b.model = a.model
        AND b.channel_id = apimart.id
    )
  RETURNING a."group", a.model, a.channel_id
)
SELECT count(*) AS abilities_moved FROM moved;

-- 删除残留的同 (group, model) 但 channel_id 错位（迁移因冲突没动到的孤儿）
WITH apimart AS (
  SELECT id FROM channels WHERE name = 'apimart' AND type = 59 LIMIT 1
)
DELETE FROM abilities a
USING apimart
WHERE a.model LIKE 'doubao-seedance-2.0%face%'
  AND a.channel_id <> apimart.id;

-- -----------------------------------------------------------------------------
-- Step 2: 兜底 INSERT 4×2=8 行 abilities（face × 2 + face-apimart × 2，每个
--         在 default + auto 两个 group），ON CONFLICT 不会重插。
-- -----------------------------------------------------------------------------

WITH apimart AS (
  SELECT id FROM channels WHERE name = 'apimart' AND type = 59 LIMIT 1
),
face_models(model) AS (VALUES
  ('doubao-seedance-2.0-face'),
  ('doubao-seedance-2.0-fast-face'),
  ('doubao-seedance-2.0-face-apimart'),
  ('doubao-seedance-2.0-fast-face-apimart')
),
ability_matrix AS (
  SELECT g.ability_group, m.model, c.id AS channel_id
  FROM face_models AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
  CROSS JOIN apimart AS c
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, am.channel_id, true, 0, 0, 'apimart'
FROM ability_matrix AS am
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, tag = EXCLUDED.tag;

-- -----------------------------------------------------------------------------
-- Step 3: channels.models 追加 face 4 条（每条单独 guard，避免 face 子串
--         匹配 fast-face 误判）。逗号包夹判等：',a,b,c,'.
-- -----------------------------------------------------------------------------

UPDATE channels SET models = models || ',doubao-seedance-2.0-face'
WHERE name = 'apimart' AND type = 59
  AND ',' || models || ',' NOT LIKE '%,doubao-seedance-2.0-face,%';

UPDATE channels SET models = models || ',doubao-seedance-2.0-fast-face'
WHERE name = 'apimart' AND type = 59
  AND ',' || models || ',' NOT LIKE '%,doubao-seedance-2.0-fast-face,%';

UPDATE channels SET models = models || ',doubao-seedance-2.0-face-apimart'
WHERE name = 'apimart' AND type = 59
  AND ',' || models || ',' NOT LIKE '%,doubao-seedance-2.0-face-apimart,%';

UPDATE channels SET models = models || ',doubao-seedance-2.0-fast-face-apimart'
WHERE name = 'apimart' AND type = 59
  AND ',' || models || ',' NOT LIKE '%,doubao-seedance-2.0-fast-face-apimart,%';

-- -----------------------------------------------------------------------------
-- Step 4: channels.model_mapping 追加 -apimart 别名 → 上游 model 的映射。
--         jsonb || jsonb 同 key 覆盖（值一致），幂等。
-- -----------------------------------------------------------------------------

UPDATE channels
SET model_mapping = (
  COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
  || '{"doubao-seedance-2.0-face-apimart":"doubao-seedance-2.0-face","doubao-seedance-2.0-fast-face-apimart":"doubao-seedance-2.0-fast-face"}'::jsonb
)::text
WHERE name = 'apimart' AND type = 59;

-- -----------------------------------------------------------------------------
-- 验证：以下 SELECT 输出供肉眼确认。如果与预期不符，Ctrl-C 终止后事务自动 ROLLBACK。
-- -----------------------------------------------------------------------------

\echo
\echo '----- abilities 修复后（应 8 行，channel_id 全部一致 = apimart 真实 id）-----'
SELECT a."group", a.model, a.channel_id, c.name AS channel_name, a.enabled
FROM abilities a
LEFT JOIN channels c ON c.id = a.channel_id
WHERE a.model LIKE 'doubao-seedance-2.0%face%'
ORDER BY a.model, a."group";

\echo
\echo '----- apimart channel.models 应 4 个 face 串都为 t -----'
SELECT id, name,
       ',' || models || ',' LIKE '%,doubao-seedance-2.0-face,%'              AS has_face,
       ',' || models || ',' LIKE '%,doubao-seedance-2.0-fast-face,%'         AS has_fast_face,
       ',' || models || ',' LIKE '%,doubao-seedance-2.0-face-apimart,%'      AS has_face_apimart,
       ',' || models || ',' LIKE '%,doubao-seedance-2.0-fast-face-apimart,%' AS has_fast_face_apimart
FROM channels
WHERE name = 'apimart' AND type = 59;

\echo
\echo '----- apimart channel.model_mapping 应包含 -apimart 别名两条 -----'
SELECT id, name,
       (model_mapping::jsonb ? 'doubao-seedance-2.0-face-apimart')      AS has_face_alias,
       (model_mapping::jsonb ? 'doubao-seedance-2.0-fast-face-apimart') AS has_fast_face_alias
FROM channels
WHERE name = 'apimart' AND type = 59;

COMMIT;
