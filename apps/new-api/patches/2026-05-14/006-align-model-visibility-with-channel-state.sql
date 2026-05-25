-- =============================================================
-- Patch: 2026-05-14/006-align-model-visibility-with-channel-state
-- 将模型可见性与渠道状态对齐：渠道禁用 → 模型不展示。
--
-- 背景：
--   1. patch 2026-05-13/005 禁用了 yunwu 系列渠道（abilities.enabled=false），
--      但 patch 2026-05-14/003 又将 nanobanana 三件套 models.status 设为 1，
--      导致 /new-api-models 仍返回这些模型（读 models.status），
--      而 4455/v1/models 不返回（读 abilities.enabled）——前后矛盾。
--   2. gpt-image-2-apimart 的 abilities 仍 enabled=true，
--      导致 4455/v1/models 暴露内部渠道别名（应隐藏）。
--
-- 修复：
--   A. nanobanana 三件套 models.status → 0
--      （跟随 yunwu-gemini 渠道禁用状态，从 /new-api-models 消失）
--   B. gpt-image-2-apimart / gpt-image-2-suchuang abilities → enabled=false
--      （从 4455/v1/models 隐藏内部别名，只保留 gpt-image-2 主模型）
--
-- 执行范围：[tapcanvas_new_api] PostgreSQL，data-only，幂等
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── A: nanobanana 模型跟随渠道禁用 ──────────────────────────────────────────

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('nanobanana2', 'nano-banana-fast', 'nano-banana-pro')
  AND deleted_at IS NULL
  AND status <> 0;

-- ── B: 隐藏 gpt-image-2 内部渠道别名的 abilities ────────────────────────────

UPDATE abilities
SET enabled = false
WHERE model IN ('gpt-image-2-apimart', 'gpt-image-2-suchuang',
                'gpt-image-2-all', 'gpt-image-2-rightcodes')
  AND enabled = true;

-- ── 验证 ─────────────────────────────────────────────────────────────────────

\echo '----- nanobanana 模型状态 -----'
SELECT model_name, status FROM models
WHERE model_name IN ('nanobanana2','nano-banana-fast','nano-banana-pro')
  AND deleted_at IS NULL
ORDER BY model_name;

\echo '----- gpt-image-2 系列 abilities（仅 enabled=true）-----'
SELECT a.model, c.name AS channel, a.enabled
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE a.model LIKE 'gpt-image-2%' AND a.enabled = true
ORDER BY a.model, c.name;

COMMIT;
