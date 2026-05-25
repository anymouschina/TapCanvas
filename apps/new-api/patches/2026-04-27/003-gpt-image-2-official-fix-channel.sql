-- 003-gpt-image-2-official-fix-channel.sql
-- Purpose: gpt-image-2-official 走 apimart 渠道，不走单独的 openai-official 渠道。
--          002 patch 误建了一个 type=1 / key=PLACEHOLDER_OPENAI_OFFICIAL_KEY 的
--          openai-official 渠道，导致调用时返回 invalid_api_key。
--          本 patch：
--            1. 将 gpt-image-2-official 加入 apimart 渠道 (type=59)
--            2. 在 apimart model_mapping 中加 "gpt-image-2-official":"gpt-image-2"
--            3. 将 abilities 切换到 apimart channel
--            4. 禁用/删除 openai-official 渠道中的 gpt-image-2-official 能力
--            5. ModelPrice 保持不变（已由 002 写入）
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: 把 gpt-image-2-official 加到 apimart channel 的 models 列表
--         model_mapping 追加 "gpt-image-2-official":"gpt-image-2"
-- -----------------------------------------------------------------------------

UPDATE channels
SET
  models = CASE
    WHEN models LIKE '%gpt-image-2-official%' THEN models
    ELSE models || ',gpt-image-2-official'
  END,
  model_mapping = (
    model_mapping::jsonb || '{"gpt-image-2-official":"gpt-image-2"}'::jsonb
  )::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default';

-- -----------------------------------------------------------------------------
-- Step 2: 注册 abilities（default + auto 路由组），指向 apimart channel
-- -----------------------------------------------------------------------------

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group, 'gpt-image-2-official', c.id, true, 0, 0, 'apimart'
FROM channels AS c
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
WHERE c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- -----------------------------------------------------------------------------
-- Step 3: 删除 openai-official 渠道中 gpt-image-2-official 的 abilities
--         并禁用/删除该渠道（避免继续被路由到）
-- -----------------------------------------------------------------------------

DELETE FROM abilities
WHERE model = 'gpt-image-2-official'
  AND channel_id IN (
    SELECT id FROM channels WHERE name = 'openai-official' AND type = 1
  );

-- 禁用 openai-official 渠道（status=2 = disabled），保留记录供审计
UPDATE channels
SET status = 2
WHERE name = 'openai-official' AND type = 1;

COMMIT;

-- 验证：
-- SELECT c.name, c.type, a.model, a.enabled, a.tag
-- FROM abilities a JOIN channels c ON c.id = a.channel_id
-- WHERE a.model = 'gpt-image-2-official';
--
-- SELECT name, type, status, models FROM channels
-- WHERE name IN ('apimart', 'openai-official');
