-- 003-gpt-image-2-official-passthrough.sql
-- Purpose: 撤销 patches/2026-04-27/002 + 003 给 apimart channel 写入的
--          "gpt-image-2-official": "gpt-image-2" model_mapping。
--
-- Background:
--   原 patch 假设 apimart 上游只认 model_name="gpt-image-2"，把 -official
--   只当 TapCanvas-side 路由标签。实际 apimart 是把 -official 作为独立 SKU
--   提供官方账号直连的，必须把 -official 原样透给上游。
--   留下 mapping 会让 -official 请求被改写成 gpt-image-2，绕过官方账号 SKU。
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent。
--        只删除 apimart channel 上的 -official 这一条 mapping 键，
--        其他 mapping（-apimart / 其它 -official-apimart 等）不动。
-- After: docker restart <new-api container>  以刷新 channel mapping 缓存。

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET model_mapping = (
      COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
      - 'gpt-image-2-official'
    )::text
WHERE name = 'apimart' AND type = 59
  AND COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb) ? 'gpt-image-2-official';

\echo
\echo '----- apimart channel.model_mapping 现状（应不再含 gpt-image-2-official）-----'
SELECT id, name,
       (model_mapping::jsonb ? 'gpt-image-2-official')         AS still_has_official,
       (model_mapping::jsonb ? 'gpt-image-2-official-apimart') AS still_has_official_apimart,
       model_mapping::jsonb -> 'gpt-image-2-official'          AS official_value
FROM channels WHERE name = 'apimart' AND type = 59;

COMMIT;
