-- 003-add-packy-gpt5x-channel.sql
-- Purpose:
--   Add the PackyAPI OpenAI-compatible channel from apps/agents-cli/agents.config.json
--   and price its visible gpt-5.x catalog at procurement price +50%.
--
-- Pricing source: docs/2881777443964_.pic_hd.jpg (PackyCode pricing page)
-- Unit conversion:
--   new-api ModelRatio 1.0 = $2.00 / 1M input tokens.
--   CompletionRatio = output_price / input_price.
--   CacheRatio = cached_input_price / input_price.
--
-- Scope: PostgreSQL (new-api DB), data-only, idempotent.
-- Note:
--   No vendor aliases are used. These ratios are keyed by the real model names,
--   so they apply globally in new-api pricing for the same model names.

\set ON_ERROR_STOP on

BEGIN;

WITH vendor_seed(name, description, icon, status) AS (
  VALUES ('PackyAPI', 'PackyAPI / PackyCode OpenAI-compatible gateway for GPT-5.x models', NULL, 1)
)
INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT
  s.name,
  s.description,
  s.icon,
  s.status,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM vendors AS v
  WHERE v.name = s.name AND v.deleted_at IS NULL
);

UPDATE vendors AS target
SET
  description = 'PackyAPI / PackyCode OpenAI-compatible gateway for GPT-5.x models',
  status = 1,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE target.name = 'PackyAPI' AND target.deleted_at IS NULL;

WITH gpt5_models(model_name) AS (
  VALUES
    ('gpt-5.2'),
    ('gpt-5.2-high'),
    ('gpt-5.2-low'),
    ('gpt-5.2-medium'),
    ('gpt-5.2-xhigh'),
    ('gpt-5.3-codex'),
    ('gpt-5.3-codex-high'),
    ('gpt-5.3-codex-low'),
    ('gpt-5.3-codex-medium'),
    ('gpt-5.3-codex-xhigh'),
    ('gpt-5.4'),
    ('gpt-5.4-high'),
    ('gpt-5.4-mini'),
    ('gpt-5.5')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  m.model_name,
  'PackyAPI upstream ' || m.model_name,
  NULL,
  NULL,
  v.id,
  NULL,
  'chat',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM gpt5_models AS m
CROSS JOIN (SELECT id FROM vendors WHERE name = 'PackyAPI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models AS existing
  WHERE existing.model_name = m.model_name AND existing.deleted_at IS NULL
);

UPDATE models AS target
SET
  kind = 'chat',
  status = 1,
  deleted_at = NULL,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM (
  VALUES
    ('gpt-5.2'),
    ('gpt-5.2-high'),
    ('gpt-5.2-low'),
    ('gpt-5.2-medium'),
    ('gpt-5.2-xhigh'),
    ('gpt-5.3-codex'),
    ('gpt-5.3-codex-high'),
    ('gpt-5.3-codex-low'),
    ('gpt-5.3-codex-medium'),
    ('gpt-5.3-codex-xhigh'),
    ('gpt-5.4'),
    ('gpt-5.4-high'),
    ('gpt-5.4-mini'),
    ('gpt-5.5')
) AS m(model_name)
WHERE target.model_name = m.model_name AND target.deleted_at IS NULL;

WITH channel_seed(name, type, channel_group, models, status, base_url, key, priority, weight, tag) AS (
  VALUES (
    'packyapi-gpt5x',
    1,
    'default',
    'gpt-5.2,gpt-5.2-high,gpt-5.2-low,gpt-5.2-medium,gpt-5.2-xhigh,gpt-5.3-codex,gpt-5.3-codex-high,gpt-5.3-codex-low,gpt-5.3-codex-medium,gpt-5.3-codex-xhigh,gpt-5.4,gpt-5.4-high,gpt-5.4-mini,gpt-5.5',
    1,
    'https://www.packyapi.com',
    'REPLACE_WITH_PACKYAPI_KEY',
    0,
    0,
    'packyapi'
  )
)
INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT
  s.name,
  s.type,
  s.channel_group,
  s.models,
  NULL,
  s.status,
  s.base_url,
  s.key,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  s.priority,
  s.weight,
  s.tag,
  NULL,
  NULL,
  NULL
FROM channel_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM channels AS existing
  WHERE existing.name = s.name AND existing.type = s.type AND existing."group" = s.channel_group
);

UPDATE channels AS target
SET
  models = 'gpt-5.2,gpt-5.2-high,gpt-5.2-low,gpt-5.2-medium,gpt-5.2-xhigh,gpt-5.3-codex,gpt-5.3-codex-high,gpt-5.3-codex-low,gpt-5.3-codex-medium,gpt-5.3-codex-xhigh,gpt-5.4,gpt-5.4-high,gpt-5.4-mini,gpt-5.5',
  model_mapping = NULL,
  base_url = 'https://www.packyapi.com'
WHERE target.name = 'packyapi-gpt5x' AND target.type = 1 AND target."group" = 'default';

WITH gpt5_models(model_name) AS (
  VALUES
    ('gpt-5.2'),
    ('gpt-5.2-high'),
    ('gpt-5.2-low'),
    ('gpt-5.2-medium'),
    ('gpt-5.2-xhigh'),
    ('gpt-5.3-codex'),
    ('gpt-5.3-codex-high'),
    ('gpt-5.3-codex-low'),
    ('gpt-5.3-codex-medium'),
    ('gpt-5.3-codex-xhigh'),
    ('gpt-5.4'),
    ('gpt-5.4-high'),
    ('gpt-5.4-mini'),
    ('gpt-5.5')
),
ability_matrix AS (
  SELECT g.ability_group, m.model_name
  FROM gpt5_models AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  am.ability_group,
  am.model_name,
  c.id,
  true,
  0,
  0,
  'packyapi'
FROM ability_matrix AS am
JOIN channels AS c
  ON c.name = 'packyapi-gpt5x' AND c.type = 1 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

-- Packy procurement +50% final prices:
--   gpt-5.2 / gpt-5.3-codex family: input $0.657/M, output $5.250/M, cache $0.066/M
--   gpt-5.4 family:                 input $0.9375/M, output $5.625/M, cache $0.0945/M
--   gpt-5.4-mini:                   input $0.282/M, output $1.6875/M, cache $0.0285/M
--   gpt-5.5:                        input $1.875/M, output $11.250/M, cache $0.1875/M

INSERT INTO options (key, value)
VALUES (
  'ModelRatio',
  $json${
    "gpt-5.2": 0.3285,
    "gpt-5.2-high": 0.3285,
    "gpt-5.2-low": 0.3285,
    "gpt-5.2-medium": 0.3285,
    "gpt-5.2-xhigh": 0.3285,
    "gpt-5.3-codex": 0.3285,
    "gpt-5.3-codex-high": 0.3285,
    "gpt-5.3-codex-low": 0.3285,
    "gpt-5.3-codex-medium": 0.3285,
    "gpt-5.3-codex-xhigh": 0.3285,
    "gpt-5.4": 0.46875,
    "gpt-5.4-high": 0.46875,
    "gpt-5.4-mini": 0.141,
    "gpt-5.5": 0.9375
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

INSERT INTO options (key, value)
VALUES (
  'CompletionRatio',
  $json${
    "gpt-5.2": 7.990867579908676,
    "gpt-5.2-high": 7.990867579908676,
    "gpt-5.2-low": 7.990867579908676,
    "gpt-5.2-medium": 7.990867579908676,
    "gpt-5.2-xhigh": 7.990867579908676,
    "gpt-5.3-codex": 7.990867579908676,
    "gpt-5.3-codex-high": 7.990867579908676,
    "gpt-5.3-codex-low": 7.990867579908676,
    "gpt-5.3-codex-medium": 7.990867579908676,
    "gpt-5.3-codex-xhigh": 7.990867579908676,
    "gpt-5.4": 6.0,
    "gpt-5.4-high": 6.0,
    "gpt-5.4-mini": 5.984042553191489,
    "gpt-5.5": 6.0
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

INSERT INTO options (key, value)
VALUES (
  'CacheRatio',
  $json${
    "gpt-5.2": 0.10045662100456621,
    "gpt-5.2-high": 0.10045662100456621,
    "gpt-5.2-low": 0.10045662100456621,
    "gpt-5.2-medium": 0.10045662100456621,
    "gpt-5.2-xhigh": 0.10045662100456621,
    "gpt-5.3-codex": 0.10045662100456621,
    "gpt-5.3-codex-high": 0.10045662100456621,
    "gpt-5.3-codex-low": 0.10045662100456621,
    "gpt-5.3-codex-medium": 0.10045662100456621,
    "gpt-5.3-codex-xhigh": 0.10045662100456621,
    "gpt-5.4": 0.1008,
    "gpt-5.4-high": 0.1008,
    "gpt-5.4-mini": 0.10106382978723405,
    "gpt-5.5": 0.1
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo
\echo '----- PackyAPI GPT-5.x channel + pricing -----'
SELECT
  c.id,
  c.name,
  c.type,
  c.base_url,
  c.models
FROM channels AS c
WHERE c.name = 'packyapi-gpt5x' AND c.type = 1 AND c."group" = 'default';

SELECT
  key,
  value::jsonb -> 'gpt-5.2' AS gpt_52,
  value::jsonb -> 'gpt-5.4' AS gpt_54,
  value::jsonb -> 'gpt-5.4-mini' AS gpt_54_mini,
  value::jsonb -> 'gpt-5.5' AS gpt_55
FROM options
WHERE key IN ('ModelRatio', 'CompletionRatio', 'CacheRatio')
ORDER BY key;

COMMIT;
