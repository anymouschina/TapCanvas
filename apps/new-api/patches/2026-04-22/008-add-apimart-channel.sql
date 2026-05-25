-- 008-add-apimart-channel.sql
-- Purpose: register the APIMart (apimart.ai) vendor, a curated set of
--          business-aligned models, the apimart channel (ChannelType 59),
--          abilities, and placeholder pricing.
--
-- Scope policy: only 9 "主力" models are enabled here, matching the coverage
--          of the other vendors already seeded (yunwu / wuyinkeji / comfly /
--          ark-doubao-video). APIMart exposes many more (79+ in total via
--          docs.apimart.ai); they are intentionally omitted to keep the
--          ability/pricing tables proportional to the rest of the catalog.
--          Companion patch 009-prune-apimart-extras.sql removes any stale
--          rows left over from an earlier, wider version of this patch.
--
-- Every kept real upstream id is exposed under TWO forms:
--   (1) the real id itself                       — e.g. `gpt-image-2`
--   (2) a vendor-suffixed alias                  — e.g. `gpt-image-2-apimart`
-- Form (2) is resolved to form (1) via channels.model_mapping.
-- Catalog source: https://docs.apimart.ai/sitemap.xml (accessed 2026-04-22).
-- Key: placeholder — operator fills in via new-api admin console after apply.
-- Scope: PostgreSQL only, data-only, idempotent execution required.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Seed vendor.
-- -----------------------------------------------------------------------------

WITH vendor_seed(name, description, icon, status) AS (
  VALUES ('APIMart AI', 'APIMart (apimart.ai) unified OpenAI-compatible gateway — chat (sync), image + video (async tasks)', NULL, 1)
)
INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT s.name, s.description, s.icon, s.status,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM vendors AS existing
  WHERE existing.name = s.name AND existing.deleted_at IS NULL
);

UPDATE vendors AS v
SET description  = 'APIMart (apimart.ai) unified OpenAI-compatible gateway — chat (sync), image + video (async tasks)',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE v.name = 'APIMart AI' AND v.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 2: Seed the 9 KEEP models in both real-id and <id>-apimart forms.
-- -----------------------------------------------------------------------------

WITH base_models(base_name, kind) AS (VALUES
  ('gemini-2.5-pro',                  'chat'),  -- Gemini 新版 chat 主力
  ('gpt-image-2',                     'image'), -- 对齐业务 gpt-image-2*
  ('gemini-2.5-flash-image-preview',  'image'), -- 对齐业务 nano-banana-fast
  ('gemini-3-pro-image-preview',      'image'), -- 对齐业务 nano-banana-pro
  ('gemini-3.1-flash-image-preview',  'image'), -- 对齐业务 nanobanana2
  ('veo3.1-fast',                     'video'), -- 对齐业务 veo_3_1-fast
  ('kling-v3',                        'video'), -- 对齐业务 kling-v3
  ('doubao-seedance-2.0',             'video'), -- 对齐业务 Seedance 2.0
  ('doubao-seedance-2.0-fast',        'video')  -- 对齐业务 Seedance 2.0 Fast
),
all_forms AS (
  SELECT base_name AS model_name, kind,
         'APIMart upstream ' || base_name AS description
  FROM base_models
  UNION ALL
  SELECT base_name || '-apimart' AS model_name, kind,
         'APIMart vendor-suffixed alias for upstream ' || base_name AS description
  FROM base_models
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT f.model_name, f.description, NULL, NULL, v.id, NULL, f.kind, 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM all_forms AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models AS m
  WHERE m.model_name = f.model_name AND m.deleted_at IS NULL
);

-- Keep vendor_id / kind in sync for re-runs on the 9 <id>-apimart aliases
-- only. Real ids (form 1) are NOT force-updated because they may already
-- have been seeded by another vendor (e.g. kling-v3 was seeded by yunwu)
-- and we don't want to steal ownership.
WITH base_models(base_name, kind) AS (VALUES
  ('gemini-2.5-pro','chat'),
  ('gpt-image-2','image'),
  ('gemini-2.5-flash-image-preview','image'),
  ('gemini-3-pro-image-preview','image'),
  ('gemini-3.1-flash-image-preview','image'),
  ('veo3.1-fast','video'),
  ('kling-v3','video'),
  ('doubao-seedance-2.0','video'),
  ('doubao-seedance-2.0-fast','video')
),
alias_forms AS (
  SELECT base_name || '-apimart' AS model_name, kind FROM base_models
)
UPDATE models AS target
SET kind         = f.kind,
    vendor_id    = v.id,
    status       = 1,
    deleted_at   = NULL,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM alias_forms AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE target.model_name = f.model_name;

-- -----------------------------------------------------------------------------
-- Step 3: Upsert channel (type 59 = ChannelTypeApimart).
-- -----------------------------------------------------------------------------

WITH channel_seed(name, type, channel_group, models, model_mapping, status, base_url, key, priority, weight, tag) AS (
  VALUES (
    'apimart',
    59,
    'default',
    'gemini-2.5-pro,gpt-image-2,gemini-2.5-flash-image-preview,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,veo3.1-fast,kling-v3,doubao-seedance-2.0,doubao-seedance-2.0-fast,gemini-2.5-pro-apimart,gpt-image-2-apimart,gemini-2.5-flash-image-preview-apimart,gemini-3-pro-image-preview-apimart,gemini-3.1-flash-image-preview-apimart,veo3.1-fast-apimart,kling-v3-apimart,doubao-seedance-2.0-apimart,doubao-seedance-2.0-fast-apimart',
    $json${
      "gemini-2.5-pro-apimart": "gemini-2.5-pro",
      "gpt-image-2-apimart": "gpt-image-2",
      "gemini-2.5-flash-image-preview-apimart": "gemini-2.5-flash-image-preview",
      "gemini-3-pro-image-preview-apimart": "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview-apimart": "gemini-3.1-flash-image-preview",
      "veo3.1-fast-apimart": "veo3.1-fast",
      "kling-v3-apimart": "kling-v3",
      "doubao-seedance-2.0-apimart": "doubao-seedance-2.0",
      "doubao-seedance-2.0-fast-apimart": "doubao-seedance-2.0-fast"
    }$json$,
    1,
    'https://api.apimart.ai',
    'PLACEHOLDER_APIMART_KEY',
    0, 0, 'apimart'
  )
)
INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT s.name, s.type, s.channel_group, s.models, s.model_mapping, s.status, s.base_url, s.key,
       EXTRACT(EPOCH FROM NOW())::bigint, 0, s.priority, s.weight, s.tag,
       NULL, NULL, NULL
FROM channel_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM channels AS existing
  WHERE existing.name = s.name AND existing.type = s.type AND existing."group" = s.channel_group
);

-- Keep models / model_mapping / base_url in sync on re-runs. key / status /
-- priority / weight / tag are NOT touched (may have been edited in admin UI).
UPDATE channels AS target
SET models        = 'gemini-2.5-pro,gpt-image-2,gemini-2.5-flash-image-preview,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,veo3.1-fast,kling-v3,doubao-seedance-2.0,doubao-seedance-2.0-fast,gemini-2.5-pro-apimart,gpt-image-2-apimart,gemini-2.5-flash-image-preview-apimart,gemini-3-pro-image-preview-apimart,gemini-3.1-flash-image-preview-apimart,veo3.1-fast-apimart,kling-v3-apimart,doubao-seedance-2.0-apimart,doubao-seedance-2.0-fast-apimart',
    model_mapping = $json${
      "gemini-2.5-pro-apimart": "gemini-2.5-pro",
      "gpt-image-2-apimart": "gpt-image-2",
      "gemini-2.5-flash-image-preview-apimart": "gemini-2.5-flash-image-preview",
      "gemini-3-pro-image-preview-apimart": "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview-apimart": "gemini-3.1-flash-image-preview",
      "veo3.1-fast-apimart": "veo3.1-fast",
      "kling-v3-apimart": "kling-v3",
      "doubao-seedance-2.0-apimart": "doubao-seedance-2.0",
      "doubao-seedance-2.0-fast-apimart": "doubao-seedance-2.0-fast"
    }$json$,
    base_url      = 'https://api.apimart.ai'
WHERE target.name = 'apimart' AND target.type = 59 AND target."group" = 'default';

-- -----------------------------------------------------------------------------
-- Step 4: Seed abilities (default + auto groups) for every kept model form.
-- -----------------------------------------------------------------------------

WITH base_models(base_name) AS (VALUES
  ('gemini-2.5-pro'),
  ('gpt-image-2'),
  ('gemini-2.5-flash-image-preview'),
  ('gemini-3-pro-image-preview'),
  ('gemini-3.1-flash-image-preview'),
  ('veo3.1-fast'),
  ('kling-v3'),
  ('doubao-seedance-2.0'),
  ('doubao-seedance-2.0-fast')
),
all_model_names AS (
  SELECT base_name AS model FROM base_models
  UNION ALL
  SELECT base_name || '-apimart' FROM base_models
),
ability_matrix AS (
  SELECT g.ability_group, m.model
  FROM all_model_names AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, c.id, true, 0, 0, 'apimart'
FROM ability_matrix AS am
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- -----------------------------------------------------------------------------
-- Step 5: Seed ModelPrice for async image/video (flat per-task USD).
-- Chat is priced by token via code-level ModelRatio (see step 6 for the
-- alias duplicates).
-- Numbers match existing DB analogs (see header of 008 predecessor):
--   gpt-image-2            = 5   (matches existing gpt-image-2 = 5)
--   gemini flash image     = 3
--   gemini-3-pro image     = 10
--   veo3.1-fast            = 55  (matches existing veo_3_1 = 55)
--   kling-v3               = 14  (matches existing kling-v3 = 14)
--   seedance 2.0 / fast    = 20 / 15
-- Merge strategy: existing DB entries take priority (admin overrides survive).
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${
    "gpt-image-2": 5,
    "gpt-image-2-apimart": 5,
    "gemini-2.5-flash-image-preview": 3,
    "gemini-2.5-flash-image-preview-apimart": 3,
    "gemini-3-pro-image-preview-apimart": 10,
    "gemini-3.1-flash-image-preview-apimart": 3,
    "veo3.1-fast": 55,
    "veo3.1-fast-apimart": 55,
    "kling-v3-apimart": 14,
    "doubao-seedance-2.0": 20,
    "doubao-seedance-2.0-apimart": 20,
    "doubao-seedance-2.0-fast": 15,
    "doubao-seedance-2.0-fast-apimart": 15
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

-- -----------------------------------------------------------------------------
-- Step 6: Seed ModelRatio overrides for the chat alias.
-- The real id `gemini-2.5-pro` already resolves via code-level
-- defaultModelRatio; the `-apimart` alias does not, so mirror the number
-- here via the DB override.
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelRatio',
  $json${
    "gemini-2.5-pro-apimart": 0.625
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
