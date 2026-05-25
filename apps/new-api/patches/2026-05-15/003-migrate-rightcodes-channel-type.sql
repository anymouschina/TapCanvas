-- =============================================================
-- Patch: 2026-05-15/003-migrate-rightcodes-channel-type
-- 将 rightcodes-draw 渠道 type 从 1（OpenAI 透传）升级为 60（RightCode 专用适配器）。
-- RightCode 适配器负责将 1K/2K/4K + aspect-ratio 转换为 NxM 像素尺寸。
-- =============================================================

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET type = 60
WHERE name = 'rightcodes-draw'
  AND base_url = 'https://www.right.codes/draw';

-- 验证
\echo '----- rightcodes-draw channel type after migration -----'
SELECT id, name, type, base_url FROM channels
WHERE name = 'rightcodes-draw';

COMMIT;
