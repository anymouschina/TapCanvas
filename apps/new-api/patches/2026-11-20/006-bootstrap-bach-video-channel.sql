-- Bootstrap the Bach 1.0 Pro / Bach 1.0 Pro Ads video channel (ChannelTypeBach = 78).
-- PostgreSQL deployment data patch; no schema migration or private credentials.
--
-- Provider contract:
--   Base URL: https://api-gen-na.bach.art/api/vdr
--   Protocol: task.bach-video (POST /video/v2 and GET /video/v2/{task_id})
--   Auth:     HS256 JWT Bearer signed with AccessKey|SecretKey
--   Apply:    https://link.bach.art/4iThiO3
--
-- Security: credentials are never stored in this patch. The channel is created
-- with an empty key and status = 2 (disabled), with disabled abilities.
-- Administrators click "申请 API Key" / "申请密钥" in the new-api console to
-- open https://link.bach.art/4iThiO3, fill in AccessKey|SecretKey, and
-- explicitly enable the channel. Re-runs preserve existing keys, channel
-- status, and any custom ModelPrice overrides.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF (
    SELECT COUNT(*) FROM vendors
    WHERE name = 'Bach' AND deleted_at IS NULL
  ) > 1 THEN
    RAISE EXCEPTION 'expected at most one active Bach vendor';
  END IF;

  IF (
    SELECT COUNT(*) FROM channels
    WHERE name = 'bach-video'
  ) > 1 THEN
    RAISE EXCEPTION 'expected at most one bach-video channel';
  END IF;
END
$$;

INSERT INTO vendors (
  name, description, icon, status, created_time, updated_time
)
SELECT
  'Bach',
  'Bach 1.0 Pro / Ads video generation (https://link.bach.art/4iThiO3)',
  NULL,
  1,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM vendors
  WHERE name = 'Bach' AND deleted_at IS NULL
);

UPDATE vendors
SET
  description = 'Bach 1.0 Pro / Ads video generation (https://link.bach.art/4iThiO3)',
  status = 1,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'Bach' AND deleted_at IS NULL;

CREATE TEMP TABLE bach_model_snapshot (
  payload jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO bach_model_snapshot (payload)
VALUES
  ('{"model_name":"Bach-1.0-Pro","description":"Bach 1.0 Pro · 通用视频生成 · 文生/首尾帧/多模态参考/视频编辑，5–16 秒，1080P/4K","endpoints":["openai-video"],"kind":"video","capabilities":"[\"text_to_video\",\"image_to_video\",\"reference_images\",\"reference_videos\",\"reference_audios\"]","params_def":"[{\"key\":\"duration\",\"type\":\"enum\",\"label\":\"时长\",\"default\":5,\"options\":[{\"value\":5,\"label\":\"5s\"},{\"value\":6,\"label\":\"6s\"},{\"value\":7,\"label\":\"7s\"},{\"value\":8,\"label\":\"8s\"},{\"value\":9,\"label\":\"9s\"},{\"value\":10,\"label\":\"10s\"},{\"value\":11,\"label\":\"11s\"},{\"value\":12,\"label\":\"12s\"},{\"value\":13,\"label\":\"13s\"},{\"value\":14,\"label\":\"14s\"},{\"value\":15,\"label\":\"15s\"},{\"value\":16,\"label\":\"16s\"}]},{\"key\":\"resolution\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"1080p\",\"options\":[{\"value\":\"1080p\",\"label\":\"1080P\"},{\"value\":\"4k\",\"label\":\"4K\"}]},{\"key\":\"size\",\"type\":\"enum\",\"label\":\"画幅\",\"default\":\"16:9\",\"options\":[{\"value\":\"16:9\",\"label\":\"16:9\",\"aspectRatio\":\"16:9\",\"orientation\":\"landscape\"},{\"value\":\"9:16\",\"label\":\"9:16\",\"aspectRatio\":\"9:16\",\"orientation\":\"portrait\"},{\"value\":\"1:1\",\"label\":\"1:1\",\"aspectRatio\":\"1:1\"},{\"value\":\"4:3\",\"label\":\"4:3\",\"aspectRatio\":\"4:3\",\"orientation\":\"landscape\"},{\"value\":\"3:4\",\"label\":\"3:4\",\"aspectRatio\":\"3:4\",\"orientation\":\"portrait\"},{\"value\":\"21:9\",\"label\":\"21:9\",\"aspectRatio\":\"21:9\",\"orientation\":\"landscape\"},{\"value\":\"auto\",\"label\":\"自动\"}]},{\"key\":\"reference_images\",\"type\":\"integer\",\"label\":\"参考图上限\",\"default\":0,\"min\":0,\"max\":9,\"scope\":\"capability\"},{\"key\":\"reference_videos\",\"type\":\"integer\",\"label\":\"参考视频上限\",\"default\":0,\"min\":0,\"max\":3,\"scope\":\"capability\"},{\"key\":\"reference_video_duration_seconds\",\"type\":\"float\",\"label\":\"参考视频时长上限\",\"min\":2,\"max\":15,\"scope\":\"capability\"},{\"key\":\"reference_audios\",\"type\":\"integer\",\"label\":\"参考音频上限\",\"default\":0,\"min\":0,\"max\":3,\"scope\":\"capability\"},{\"key\":\"reference_audio_duration_seconds\",\"type\":\"float\",\"label\":\"单条参考音频时长上限\",\"min\":2,\"max\":15,\"scope\":\"capability\"},{\"key\":\"reference_audio_total_duration_seconds\",\"type\":\"float\",\"label\":\"参考音频总时长上限\",\"min\":2,\"max\":15,\"scope\":\"capability\"}]","name_rule":0}'::jsonb),
  ('{"model_name":"Bach-1.0-Pro-Ads","description":"Bach 1.0 Pro Ads · 广告电商视频生成 · 商品镜头与品牌大片，5–16 秒，1080P/4K","endpoints":["openai-video"],"kind":"video","capabilities":"[\"text_to_video\",\"image_to_video\",\"reference_images\",\"reference_videos\",\"reference_audios\"]","params_def":"[{\"key\":\"duration\",\"type\":\"enum\",\"label\":\"时长\",\"default\":5,\"options\":[{\"value\":5,\"label\":\"5s\"},{\"value\":6,\"label\":\"6s\"},{\"value\":7,\"label\":\"7s\"},{\"value\":8,\"label\":\"8s\"},{\"value\":9,\"label\":\"9s\"},{\"value\":10,\"label\":\"10s\"},{\"value\":11,\"label\":\"11s\"},{\"value\":12,\"label\":\"12s\"},{\"value\":13,\"label\":\"13s\"},{\"value\":14,\"label\":\"14s\"},{\"value\":15,\"label\":\"15s\"},{\"value\":16,\"label\":\"16s\"}]},{\"key\":\"resolution\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"1080p\",\"options\":[{\"value\":\"1080p\",\"label\":\"1080P\"},{\"value\":\"4k\",\"label\":\"4K\"}]},{\"key\":\"size\",\"type\":\"enum\",\"label\":\"画幅\",\"default\":\"16:9\",\"options\":[{\"value\":\"16:9\",\"label\":\"16:9\",\"aspectRatio\":\"16:9\",\"orientation\":\"landscape\"},{\"value\":\"9:16\",\"label\":\"9:16\",\"aspectRatio\":\"9:16\",\"orientation\":\"portrait\"},{\"value\":\"1:1\",\"label\":\"1:1\",\"aspectRatio\":\"1:1\"},{\"value\":\"4:3\",\"label\":\"4:3\",\"aspectRatio\":\"4:3\",\"orientation\":\"landscape\"},{\"value\":\"3:4\",\"label\":\"3:4\",\"aspectRatio\":\"3:4\",\"orientation\":\"portrait\"},{\"value\":\"21:9\",\"label\":\"21:9\",\"aspectRatio\":\"21:9\",\"orientation\":\"landscape\"},{\"value\":\"auto\",\"label\":\"自动\"}]},{\"key\":\"reference_images\",\"type\":\"integer\",\"label\":\"参考图上限\",\"default\":0,\"min\":0,\"max\":9,\"scope\":\"capability\"},{\"key\":\"reference_videos\",\"type\":\"integer\",\"label\":\"参考视频上限\",\"default\":0,\"min\":0,\"max\":3,\"scope\":\"capability\"},{\"key\":\"reference_video_duration_seconds\",\"type\":\"float\",\"label\":\"参考视频时长上限\",\"min\":2,\"max\":15,\"scope\":\"capability\"},{\"key\":\"reference_audios\",\"type\":\"integer\",\"label\":\"参考音频上限\",\"default\":0,\"min\":0,\"max\":3,\"scope\":\"capability\"},{\"key\":\"reference_audio_duration_seconds\",\"type\":\"float\",\"label\":\"单条参考音频时长上限\",\"min\":2,\"max\":15,\"scope\":\"capability\"},{\"key\":\"reference_audio_total_duration_seconds\",\"type\":\"float\",\"label\":\"参考音频总时长上限\",\"min\":2,\"max\":15,\"scope\":\"capability\"}]","name_rule":0}'::jsonb);

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind,
  capabilities, status, sync_official, created_time, updated_time, name_rule,
  params_def
)
SELECT
  payload ->> 'model_name',
  NULLIF(payload ->> 'description', ''),
  NULL,
  'bach',
  vendor.id,
  (payload -> 'endpoints')::text,
  payload ->> 'kind',
  COALESCE(NULLIF(payload ->> 'capabilities', ''), '[]'),
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  COALESCE((payload ->> 'name_rule')::integer, 0),
  payload ->> 'params_def'
FROM bach_model_snapshot
CROSS JOIN (
  SELECT id FROM vendors
  WHERE name = 'Bach' AND deleted_at IS NULL
) AS vendor
WHERE NOT EXISTS (
  SELECT 1 FROM models
  WHERE model_name = payload ->> 'model_name' AND deleted_at IS NULL
);

INSERT INTO channels (
  name,
  type,
  "group",
  models,
  model_mapping,
  status,
  base_url,
  key,
  created_time,
  test_time,
  priority,
  weight,
  tag,
  setting,
  test_model,
  auto_ban,
  param_override,
  header_override,
  remark
)
SELECT
  'bach-video',
  78,
  'default',
  'Bach-1.0-Pro,Bach-1.0-Pro-Ads',
  NULL,
  2,
  'https://api-gen-na.bach.art/api/vdr',
  '',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  0,
  100,
  'bach',
  '{"default_protocol":{"protocol":"task.bach-video"},"model_protocols":{"Bach-1.0-Pro":{"protocol":"task.bach-video"},"Bach-1.0-Pro-Ads":{"protocol":"task.bach-video"}}}',
  'Bach-1.0-Pro',
  1,
  NULL,
  NULL,
  'Bach 1.0 Pro / Ads video channel; apply for AccessKey|SecretKey at https://link.bach.art/4iThiO3'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'bach-video'
);

-- Re-runs refresh only deployment-owned connection fields; key and status are preserved.
UPDATE channels
SET
  type = 78,
  "group" = 'default',
  models = 'Bach-1.0-Pro,Bach-1.0-Pro-Ads',
  base_url = 'https://api-gen-na.bach.art/api/vdr',
  tag = 'bach',
  setting = '{"default_protocol":{"protocol":"task.bach-video"},"model_protocols":{"Bach-1.0-Pro":{"protocol":"task.bach-video"},"Bach-1.0-Pro-Ads":{"protocol":"task.bach-video"}}}',
  test_model = 'Bach-1.0-Pro',
  auto_ban = 1,
  remark = 'Bach 1.0 Pro / Ads video channel; apply for AccessKey|SecretKey at https://link.bach.art/4iThiO3'
WHERE name = 'bach-video';

INSERT INTO abilities (
  "group",
  model,
  channel_id,
  enabled,
  priority,
  weight,
  tag
)
SELECT
  'default',
  snapshot.payload ->> 'model_name',
  channel.id,
  channel.status = 1 AND length(btrim(channel.key)) > 0,
  0,
  100,
  'bach'
FROM channels AS channel
CROSS JOIN bach_model_snapshot AS snapshot
WHERE channel.name = 'bach-video'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

-- Seed default base ModelPrice (1080p, 5s official CNY list price = 4.38)
-- without overwriting administrator-customized prices.
INSERT INTO options (key, value)
VALUES
  ('ModelPrice', '{"Bach-1.0-Pro":4.38,"Bach-1.0-Pro-Ads":4.38}')
ON CONFLICT (key) DO UPDATE
SET value = (
  EXCLUDED.value::jsonb
  || COALESCE(NULLIF(options.value, ''), '{}')::jsonb
)::text;

DO $$
BEGIN
  IF (
    SELECT COUNT(*) FROM vendors
    WHERE name = 'Bach' AND status = 1 AND deleted_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Bach vendor invariant failed';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM models
    WHERE model_name IN ('Bach-1.0-Pro', 'Bach-1.0-Pro-Ads')
      AND deleted_at IS NULL
      AND status = 1
      AND kind = 'video'
  ) <> 2 THEN
    RAISE EXCEPTION 'Bach video model catalog invariant failed';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM channels AS channel
    JOIN abilities AS ability ON ability.channel_id = channel.id
    WHERE channel.name = 'bach-video'
      AND channel.type = 78
      AND channel.base_url = 'https://api-gen-na.bach.art/api/vdr'
      AND channel.setting::jsonb #>> '{default_protocol,protocol}' = 'task.bach-video'
      AND ability."group" = 'default'
      AND ability.model IN ('Bach-1.0-Pro', 'Bach-1.0-Pro-Ads')
      AND ability.enabled = (channel.status = 1 AND length(btrim(channel.key)) > 0)
  ) <> 2 THEN
    RAISE EXCEPTION 'Bach video channel/ability invariant failed';
  END IF;
END
$$;

COMMIT;
