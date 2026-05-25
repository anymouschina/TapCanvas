-- 004-add-code0ai-channel.sql
-- Purpose: add code0.ai Gemini image channel (type 65).
--
-- Models:
--   gemini-2.5-flash-image
--   gemini-3-pro-image-preview
--   gemini-3.1-flash-image-preview
--   gemini-2.0-flash-exp-image-generation
--   gemini-2.0-flash-exp
--
-- Key: PLACEHOLDER_CODE0AI_KEY — fill in via admin console after apply.
-- Auth: Bearer token (set automatically by code0ai adaptor).
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: upsert channel ────────────────────────────────────────────────────

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT
  'code0ai',
  65,
  'default',
  'gemini-2.5-flash-image,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gemini-2.0-flash-exp-image-generation,gemini-2.0-flash-exp',
  '{}',
  1,
  'https://code0.ai',
  'PLACEHOLDER_CODE0AI_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0,
  10, 100, 'code0ai',
  NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'code0ai' AND type = 65 AND "group" = 'default'
);

-- Sync models/base_url on re-runs; leave key/status/priority untouched.
UPDATE channels
SET models   = 'gemini-2.5-flash-image,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gemini-2.0-flash-exp-image-generation,gemini-2.0-flash-exp',
    base_url = 'https://code0.ai'
WHERE name = 'code0ai' AND type = 65 AND "group" = 'default';

-- ── Step 2: seed abilities ────────────────────────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model, c.id, true, 10, 100, 'code0ai'
FROM (VALUES
  ('gemini-2.5-flash-image'),
  ('gemini-3-pro-image-preview'),
  ('gemini-3.1-flash-image-preview'),
  ('gemini-2.0-flash-exp-image-generation'),
  ('gemini-2.0-flash-exp')
) AS m(model)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'code0ai' AND c.type = 65 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = true,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

\echo '----- code0ai channel after patch -----'
SELECT name, type, status, base_url,
       LEFT(models, 100) AS models_preview
FROM channels
WHERE name = 'code0ai' AND type = 65;

\echo '----- abilities seeded -----'
SELECT a."group", a.model, a.enabled, a.priority
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'code0ai' AND c.type = 65
ORDER BY a."group", a.model;

COMMIT;
