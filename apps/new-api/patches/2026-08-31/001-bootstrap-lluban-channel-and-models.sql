\set ON_ERROR_STOP on

-- The only TapCanvas new-api data patch.
-- Snapshot source: Lluban /v1/models + /api/models/list + /api/pricing on 2026-10-30
-- (pricing_version a42d372ccf0b5dd13ecf71203521f9d2).
-- The 22-model executable intersection is published: 1 image, 5 video,
-- and 16 text/chat models. Rows without live routing, metadata, positive pricing,
-- or a wire protocol this gateway can relay (e.g. audio-speech) are excluded.
-- new-api re-imports the live catalog on every start; this seed mirrors that import
-- so re-running the patch does not roll the channel back to an older model list.
-- Upstream discovery stays enabled, but automatic channel mutation is disabled:
-- a newly discovered route must gain metadata and pricing in this snapshot before publication.
-- The operator explicitly approved redistribution of the bundled free credential.
-- Re-runs preserve an administrator's replacement key and channel status.

BEGIN;

DO $$
BEGIN
  IF (
    SELECT COUNT(*) FROM vendors
    WHERE name = 'Lluban API' AND deleted_at IS NULL
  ) > 1 THEN
    RAISE EXCEPTION 'expected at most one active Lluban API vendor';
  END IF;

  IF (
    SELECT COUNT(*) FROM channels
    WHERE name = 'lluban-recommended'
  ) > 1 THEN
    RAISE EXCEPTION 'expected at most one lluban-recommended channel';
  END IF;
END
$$;

INSERT INTO vendors (
  name, description, icon, status, created_time, updated_time
)
SELECT
  'Lluban API',
  'TapCanvas recommended OpenAI-compatible relay',
  NULL,
  1,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM vendors
  WHERE name = 'Lluban API' AND deleted_at IS NULL
);

UPDATE vendors
SET
  description = 'TapCanvas recommended OpenAI-compatible relay',
  status = 1,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'Lluban API' AND deleted_at IS NULL;

CREATE TEMP TABLE lluban_model_snapshot (
  payload jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO lluban_model_snapshot (payload)
VALUES
  ('{"model_name":"deepseek-v4.1-flash","description":"DeepSeek V4.1 Flash — b-ai","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[\"streaming\",\"vision\"]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":1.095,"completion_ratio":4,"cache_ratio":0.02,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"doubao-seed-2-0-lite-260428","description":"Doubao Seed 2.0 Lite（多模态视觉理解，ARK 官渠）","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[\"function_calling\", \"reasoning_effort:high\", \"reasoning_effort:low\", \"reasoning_effort:medium\", \"reasoning_effort:minimal\", \"streaming\", \"vision\"]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":0.45,"completion_ratio":6,"cache_ratio":0.2,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"doubao-seed-2-1-lite-260915","description":"Doubao Seed 2.1 Lite（ARK 官渠；官方价 3x：输入 ¥2.4/M，输出 ¥8.1/M，音频输入 ¥36/M）","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[\"function_calling\", \"reasoning_effort:high\", \"reasoning_effort:low\", \"reasoning_effort:medium\", \"reasoning_effort:minimal\", \"streaming\", \"video_understanding\", \"vision\"]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":1.2,"completion_ratio":3.375,"cache_ratio":0.2,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"doubao-seed-2-1-pro-260915","description":"Doubao Seed 2.1 Pro（ARK 官渠；官方价 3x：输入 ¥18/M，输出 ¥90/M）","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[\"function_calling\", \"reasoning_effort:high\", \"reasoning_effort:low\", \"reasoning_effort:medium\", \"reasoning_effort:minimal\", \"streaming\", \"vision\"]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":9,"completion_ratio":5,"cache_ratio":0.2,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"doubao-seed-2-1-turbo-260628","description":"Doubao Seed 2.1 Turbo（ARK 官渠；官方价 3x：输入 ¥9/M，输出 ¥45/M）","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[\"function_calling\", \"reasoning_effort:high\", \"reasoning_effort:low\", \"reasoning_effort:medium\", \"reasoning_effort:minimal\", \"streaming\", \"vision\"]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":4.5,"completion_ratio":5,"cache_ratio":0.2,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"doubao-seedance-2.0","description":"Doubao Seedance 2.0 video generation via ByteDance ARK","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"reference_images\",\"first_last_frame\",\"text_to_video\",\"image_to_video\",\"multimodal_reference\",\"reference_videos\",\"reference_audios\",\"native_audio\"]","params_def":"[{\"default\":4,\"key\":\"duration\",\"label\":\"时长\",\"options\":[{\"label\":\"4s\",\"value\":4},{\"label\":\"5s\",\"value\":5},{\"label\":\"6s\",\"value\":6},{\"label\":\"7s\",\"value\":7},{\"label\":\"8s\",\"value\":8},{\"label\":\"9s\",\"value\":9},{\"label\":\"10s\",\"value\":10},{\"label\":\"11s\",\"value\":11},{\"label\":\"12s\",\"value\":12},{\"label\":\"13s\",\"value\":13},{\"label\":\"14s\",\"value\":14},{\"label\":\"15s\",\"value\":15}],\"type\":\"enum\"},{\"default\":\"16:9\",\"key\":\"size\",\"label\":\"画幅\",\"options\":[{\"aspectRatio\":\"21:9\",\"label\":\"21:9\",\"orientation\":\"landscape\",\"value\":\"21:9\"},{\"aspectRatio\":\"16:9\",\"label\":\"16:9\",\"orientation\":\"landscape\",\"value\":\"16:9\"},{\"aspectRatio\":\"4:3\",\"label\":\"4:3\",\"orientation\":\"landscape\",\"value\":\"4:3\"},{\"aspectRatio\":\"1:1\",\"label\":\"1:1\",\"value\":\"1:1\"},{\"aspectRatio\":\"3:4\",\"label\":\"3:4\",\"orientation\":\"portrait\",\"value\":\"3:4\"},{\"aspectRatio\":\"9:16\",\"label\":\"9:16\",\"orientation\":\"portrait\",\"value\":\"9:16\"}],\"type\":\"enum\"},{\"default\":\"720p\",\"key\":\"resolution\",\"label\":\"分辨率\",\"options\":[{\"label\":\"480p\",\"value\":\"480p\"},{\"label\":\"720p\",\"value\":\"720p\"},{\"label\":\"1080p\",\"value\":\"1080p\"}],\"type\":\"enum\"},{\"default\":0,\"key\":\"reference_images\",\"label\":\"参考图片上限\",\"max\":9,\"min\":0,\"scope\":\"capability\",\"type\":\"integer\"},{\"default\":0,\"key\":\"reference_audios\",\"label\":\"参考音频上限\",\"max\":3,\"min\":0,\"scope\":\"capability\",\"type\":\"integer\"},{\"key\":\"reference_audio_duration_seconds\",\"label\":\"单条参考音频时长上限\",\"max\":15,\"min\":1.8,\"scope\":\"capability\",\"type\":\"float\"},{\"key\":\"reference_audio_total_duration_seconds\",\"label\":\"参考音频总时长上限\",\"max\":15,\"min\":1.8,\"scope\":\"capability\",\"type\":\"float\"},{\"default\":0,\"key\":\"reference_videos\",\"label\":\"参考视频上限\",\"max\":3,\"min\":0,\"scope\":\"capability\",\"type\":\"integer\"},{\"default\":0,\"key\":\"reference_media\",\"label\":\"参考素材总数上限\",\"max\":15,\"min\":0,\"scope\":\"capability\",\"type\":\"integer\"},{\"key\":\"reference_video_duration_seconds\",\"label\":\"reference_video_duration_seconds\",\"max\":15,\"min\":1.8,\"scope\":\"capability\",\"type\":\"float\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":20,"model_ratio":0,"completion_ratio":0,"cache_ratio":0,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"doubao-seedance-2.0-fast","description":"Doubao Seedance 2.0 Fast video generation via ByteDance ARK","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"reference_images\",\"first_last_frame\"]","params_def":"[{\"key\":\"duration\",\"type\":\"enum\",\"label\":\"时长\",\"default\":4,\"options\":[{\"label\":\"4s\",\"value\":4},{\"label\":\"5s\",\"value\":5},{\"label\":\"6s\",\"value\":6},{\"label\":\"7s\",\"value\":7},{\"label\":\"8s\",\"value\":8},{\"label\":\"9s\",\"value\":9},{\"label\":\"10s\",\"value\":10},{\"label\":\"11s\",\"value\":11},{\"label\":\"12s\",\"value\":12},{\"label\":\"13s\",\"value\":13},{\"label\":\"14s\",\"value\":14},{\"label\":\"15s\",\"value\":15}]},{\"key\":\"size\",\"type\":\"enum\",\"label\":\"画幅\",\"default\":\"16:9\",\"options\":[{\"label\":\"21:9\",\"value\":\"21:9\",\"aspectRatio\":\"21:9\",\"orientation\":\"landscape\"},{\"label\":\"16:9\",\"value\":\"16:9\",\"aspectRatio\":\"16:9\",\"orientation\":\"landscape\"},{\"label\":\"4:3\",\"value\":\"4:3\",\"aspectRatio\":\"4:3\",\"orientation\":\"landscape\"},{\"label\":\"1:1\",\"value\":\"1:1\",\"aspectRatio\":\"1:1\"},{\"label\":\"3:4\",\"value\":\"3:4\",\"aspectRatio\":\"3:4\",\"orientation\":\"portrait\"},{\"label\":\"9:16\",\"value\":\"9:16\",\"aspectRatio\":\"9:16\",\"orientation\":\"portrait\"}]},{\"key\":\"resolution\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"480p\",\"options\":[{\"label\":\"480p\",\"value\":\"480p\"},{\"label\":\"720p\",\"value\":\"720p\"},{\"label\":\"1080p\",\"value\":\"1080p\"}]},{\"key\":\"reference_images\",\"max\":9,\"min\":0,\"type\":\"integer\",\"label\":\"参考图片上限\",\"scope\":\"capability\",\"default\":0}]","name_rule":0,"pricing":{"quota_type":1,"model_price":15,"model_ratio":0,"completion_ratio":0,"cache_ratio":0,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"doubao-seedance-2.5","description":"Doubao Seedance 2.5 via ByteDance ARK; multimodal references, video editing/extension, and 4-30 second generation","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"multimodal_reference\",\"reference_images\",\"reference_videos\",\"reference_audios\",\"audio_only_reference\",\"first_last_frame\",\"video_editing\",\"video_extension\",\"ultra_long_video\",\"timestamp_prompt\",\"native_audio\",\"text_to_video\",\"image_to_video\"]","params_def":"[{\"default\":5,\"key\":\"duration\",\"label\":\"时长\",\"options\":[{\"label\":\"4s\",\"value\":4},{\"label\":\"5s\",\"value\":5},{\"label\":\"6s\",\"value\":6},{\"label\":\"7s\",\"value\":7},{\"label\":\"8s\",\"value\":8},{\"label\":\"9s\",\"value\":9},{\"label\":\"10s\",\"value\":10},{\"label\":\"11s\",\"value\":11},{\"label\":\"12s\",\"value\":12},{\"label\":\"13s\",\"value\":13},{\"label\":\"14s\",\"value\":14},{\"label\":\"15s\",\"value\":15},{\"label\":\"16s\",\"value\":16},{\"label\":\"17s\",\"value\":17},{\"label\":\"18s\",\"value\":18},{\"label\":\"19s\",\"value\":19},{\"label\":\"20s\",\"value\":20},{\"label\":\"21s\",\"value\":21},{\"label\":\"22s\",\"value\":22},{\"label\":\"23s\",\"value\":23},{\"label\":\"24s\",\"value\":24},{\"label\":\"25s\",\"value\":25},{\"label\":\"26s\",\"value\":26},{\"label\":\"27s\",\"value\":27},{\"label\":\"28s\",\"value\":28},{\"label\":\"29s\",\"value\":29},{\"label\":\"30s\",\"value\":30}],\"type\":\"enum\"},{\"default\":\"16:9\",\"key\":\"size\",\"label\":\"画幅\",\"options\":[{\"aspectRatio\":\"21:9\",\"label\":\"21:9\",\"orientation\":\"landscape\",\"value\":\"21:9\"},{\"aspectRatio\":\"16:9\",\"label\":\"16:9\",\"orientation\":\"landscape\",\"value\":\"16:9\"},{\"aspectRatio\":\"4:3\",\"label\":\"4:3\",\"orientation\":\"landscape\",\"value\":\"4:3\"},{\"aspectRatio\":\"1:1\",\"label\":\"1:1\",\"value\":\"1:1\"},{\"aspectRatio\":\"3:4\",\"label\":\"3:4\",\"orientation\":\"portrait\",\"value\":\"3:4\"},{\"aspectRatio\":\"9:16\",\"label\":\"9:16\",\"orientation\":\"portrait\",\"value\":\"9:16\"}],\"type\":\"enum\"},{\"default\":\"720p\",\"key\":\"resolution\",\"label\":\"分辨率\",\"options\":[{\"label\":\"480p\",\"value\":\"480p\"},{\"label\":\"720p\",\"value\":\"720p\"},{\"label\":\"1080p\",\"value\":\"1080p\"}],\"type\":\"enum\"},{\"default\":0,\"key\":\"reference_images\",\"label\":\"参考图片上限\",\"max\":30,\"min\":0,\"scope\":\"capability\",\"type\":\"integer\"},{\"default\":0,\"key\":\"reference_videos\",\"label\":\"参考视频上限\",\"max\":10,\"min\":0,\"scope\":\"capability\",\"type\":\"integer\"},{\"default\":0,\"key\":\"reference_audios\",\"label\":\"参考音频上限\",\"max\":10,\"min\":0,\"scope\":\"capability\",\"type\":\"integer\"},{\"default\":0,\"key\":\"reference_media\",\"label\":\"参考素材总数上限\",\"max\":50,\"min\":0,\"scope\":\"capability\",\"type\":\"integer\"},{\"key\":\"reference_video_duration_seconds\",\"label\":\"单条参考视频时长上限\",\"max\":30.2,\"min\":1.8,\"scope\":\"capability\",\"type\":\"float\"},{\"key\":\"reference_audio_duration_seconds\",\"label\":\"单条参考音频时长上限\",\"max\":30.2,\"min\":1.8,\"scope\":\"capability\",\"type\":\"float\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":7.5,"model_ratio":0,"completion_ratio":0,"cache_ratio":0,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"gemini-3.1-flash-image-preview-ultra","description":"Gemini 3.1 Flash Image — beqlee 极速渠道，更快响应","tags":"","endpoints":["image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[{\"default\":\"1:1\",\"key\":\"size\",\"label\":\"宽高比\",\"options\":[{\"value\":\"1:1\",\"label\":\"1:1\"},{\"value\":\"1:4\",\"label\":\"1:4\"},{\"value\":\"1:8\",\"label\":\"1:8\"},{\"value\":\"2:3\",\"label\":\"2:3\"},{\"value\":\"3:2\",\"label\":\"3:2\"},{\"value\":\"3:4\",\"label\":\"3:4\"},{\"value\":\"4:1\",\"label\":\"4:1\"},{\"value\":\"4:3\",\"label\":\"4:3\"},{\"value\":\"4:5\",\"label\":\"4:5\"},{\"value\":\"5:4\",\"label\":\"5:4\"},{\"value\":\"8:1\",\"label\":\"8:1\"},{\"value\":\"9:16\",\"label\":\"9:16\"},{\"value\":\"16:9\",\"label\":\"16:9\"},{\"value\":\"21:9\",\"label\":\"21:9\"}],\"type\":\"enum\"},{\"default\":\"1K\",\"key\":\"resolution\",\"label\":\"分辨率\",\"options\":[{\"value\":\"512\",\"label\":\"512\"},{\"value\":\"1K\",\"label\":\"1K\"},{\"value\":\"2K\",\"label\":\"2K\"},{\"value\":\"4K\",\"label\":\"4K\"}],\"type\":\"enum\"},{\"description\":\"可选，图生图参考图 URL 列表\",\"item_type\":\"string\",\"key\":\"urls\",\"label\":\"参考图 URL\",\"scope\":\"per_request\",\"type\":\"array\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.3,"model_ratio":0,"completion_ratio":0,"cache_ratio":0,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"gemini-3.8-flash","description":"Gemini 3.8 Flash 文本模型，适合日常对话、写作与快速任务。","tags":"","endpoints":["openai","openai-response","openai-response-compact"],"kind":"chat","capabilities":"[\"streaming\",\"video_understanding\",\"vision\"]","params_def":"[{\"key\": \"max_tokens\", \"type\": \"integer\", \"label\": \"最大输出 Token\", \"min\": 1}]","name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":2.7375,"completion_ratio":5,"cache_ratio":0.1,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"gemini-4-argon","description":"Gemini 4 Argon 文本模型，支持 low/medium/high 三档思考，适合复杂推理与长文写作。","tags":"","endpoints":["openai","openai-response","openai-response-compact"],"kind":"chat","capabilities":"[\"streaming\"]","params_def":"[{\"key\": \"max_tokens\", \"type\": \"integer\", \"label\": \"最大输出 Token\", \"min\": 1}]","name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":7.3,"completion_ratio":5,"cache_ratio":0.05,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"glm-5.3-flash","description":"GLM-5.3 Flash — b-ai","tags":"","endpoints":["openai"],"kind":"chat","capabilities":"[\"streaming\",\"vision\"]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":0.5475,"completion_ratio":3.3333333333333335,"cache_ratio":0.2,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"gpt-5.6-luna","description":"gpt-5.6-luna via right.codes Codex gateway","tags":"","endpoints":["openai","openai-response","openai-response-compact"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":0.73,"completion_ratio":6,"cache_ratio":0.09999999999999999,"create_cache_ratio":1.25}}'::jsonb),
  ('{"model_name":"gpt-5.6-sol","description":"gpt-5.6-sol via right.codes Codex gateway","tags":"","endpoints":["openai","openai-response","openai-response-compact"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":14.6,"completion_ratio":5,"cache_ratio":0.1,"create_cache_ratio":1.25}}'::jsonb),
  ('{"model_name":"gpt-5.6-terra","description":"gpt-5.6-terra via right.codes Codex gateway","tags":"","endpoints":["openai","openai-response","openai-response-compact"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":7.3,"completion_ratio":6,"cache_ratio":0.1,"create_cache_ratio":1.25}}'::jsonb),
  ('{"model_name":"gpt-6-astra","description":"gpt-6-astra — OpenCodex verified","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":36.5,"completion_ratio":5,"cache_ratio":0.09999999999999999,"create_cache_ratio":1.25}}'::jsonb),
  ('{"model_name":"gpt-6-luna","description":"gpt-6-luna — OpenCodex verified","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":0.365,"completion_ratio":5,"cache_ratio":0.09999999999999999,"create_cache_ratio":1.25}}'::jsonb),
  ('{"model_name":"gpt-6-sol","description":"gpt-6-sol — OpenCodex verified","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":7.3,"completion_ratio":5,"cache_ratio":0.1,"create_cache_ratio":1.25}}'::jsonb),
  ('{"model_name":"gpt-6.1-sol","description":"gpt-6.1-sol — OpenCodex verified","tags":"","endpoints":["openai","openai-response"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":3.5,"completion_ratio":5,"cache_ratio":0.05,"create_cache_ratio":1.25}}'::jsonb),
  ('{"model_name":"minimax-h3","description":"MiniMax H3 unified text, frame and multimodal-reference video generation via Metaso","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"text_to_video\",\"multimodal_reference\",\"reference_images\",\"reference_videos\",\"reference_audios\",\"reference_audio_requires_visual\",\"exclusive_frame_reference_modes\",\"first_last_frame\"]","params_def":"[\n      {\"key\":\"duration\",\"type\":\"enum\",\"label\":\"时长\",\"default\":5,\n       \"options\":[\n         {\"value\":4,\"label\":\"4s\"},{\"value\":5,\"label\":\"5s\"},{\"value\":6,\"label\":\"6s\"},\n         {\"value\":7,\"label\":\"7s\"},{\"value\":8,\"label\":\"8s\"},{\"value\":9,\"label\":\"9s\"},\n         {\"value\":10,\"label\":\"10s\"},{\"value\":11,\"label\":\"11s\"},{\"value\":12,\"label\":\"12s\"},\n         {\"value\":13,\"label\":\"13s\"},{\"value\":14,\"label\":\"14s\"},{\"value\":15,\"label\":\"15s\"}\n       ]},\n      {\"key\":\"size\",\"type\":\"enum\",\"label\":\"画幅\",\"default\":\"16:9\",\n       \"options\":[\n         {\"value\":\"21:9\",\"label\":\"21:9\",\"aspectRatio\":\"21:9\",\"orientation\":\"landscape\"},\n         {\"value\":\"16:9\",\"label\":\"16:9\",\"aspectRatio\":\"16:9\",\"orientation\":\"landscape\"},\n         {\"value\":\"4:3\",\"label\":\"4:3\",\"aspectRatio\":\"4:3\",\"orientation\":\"landscape\"},\n         {\"value\":\"1:1\",\"label\":\"1:1\",\"aspectRatio\":\"1:1\"},\n         {\"value\":\"3:4\",\"label\":\"3:4\",\"aspectRatio\":\"3:4\",\"orientation\":\"portrait\"},\n         {\"value\":\"9:16\",\"label\":\"9:16\",\"aspectRatio\":\"9:16\",\"orientation\":\"portrait\"}\n       ]},\n      {\"key\":\"resolution\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"768p\",\n       \"options\":[{\"value\":\"768p\",\"label\":\"768P\"},{\"value\":\"1440p\",\"label\":\"1440P\"}]},\n      {\"key\":\"reference_images\",\"type\":\"integer\",\"label\":\"参考图片\",\"max\":9},\n      {\"key\":\"reference_videos\",\"type\":\"integer\",\"label\":\"参考视频\",\"max\":3},\n      {\"key\":\"reference_audios\",\"type\":\"integer\",\"label\":\"参考音频\",\"max\":3},\n      {\"key\":\"reference_media\",\"type\":\"integer\",\"label\":\"参考媒体总数\",\"max\":12},\n      {\"key\":\"reference_video_duration_seconds\",\"type\":\"integer\",\"label\":\"参考视频总时长\",\"max\":15},\n      {\"key\":\"reference_audio_duration_seconds\",\"type\":\"integer\",\"label\":\"参考音频总时长\",\"max\":15}\n    ]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.96,"model_ratio":0,"completion_ratio":0,"cache_ratio":0,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"qwen3.8-flash","description":"Qwen3.8 Flash — b-ai","tags":"","endpoints":["openai"],"kind":"chat","capabilities":"[\"streaming\",\"vision\"]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":1.1,"completion_ratio":4,"cache_ratio":0.02,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"wan3.0-video","description":"万相 3.0 视频 · mai-token · 文生/图生/参考视频，2–30 秒，480P/720P/1080P","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"text_to_video\",\"image_to_video\",\"reference_images\",\"reference_videos\",\"reference_audios\"]","params_def":"[{\"key\": \"duration\", \"type\": \"enum\", \"label\": \"时长\", \"default\": 5, \"options\": [{\"label\": \"2s\", \"value\": 2}, {\"label\": \"3s\", \"value\": 3}, {\"label\": \"4s\", \"value\": 4}, {\"label\": \"5s\", \"value\": 5}, {\"label\": \"6s\", \"value\": 6}, {\"label\": \"7s\", \"value\": 7}, {\"label\": \"8s\", \"value\": 8}, {\"label\": \"9s\", \"value\": 9}, {\"label\": \"10s\", \"value\": 10}, {\"label\": \"11s\", \"value\": 11}, {\"label\": \"12s\", \"value\": 12}, {\"label\": \"13s\", \"value\": 13}, {\"label\": \"14s\", \"value\": 14}, {\"label\": \"15s\", \"value\": 15}, {\"label\": \"16s\", \"value\": 16}, {\"label\": \"17s\", \"value\": 17}, {\"label\": \"18s\", \"value\": 18}, {\"label\": \"19s\", \"value\": 19}, {\"label\": \"20s\", \"value\": 20}, {\"label\": \"21s\", \"value\": 21}, {\"label\": \"22s\", \"value\": 22}, {\"label\": \"23s\", \"value\": 23}, {\"label\": \"24s\", \"value\": 24}, {\"label\": \"25s\", \"value\": 25}, {\"label\": \"26s\", \"value\": 26}, {\"label\": \"27s\", \"value\": 27}, {\"label\": \"28s\", \"value\": 28}, {\"label\": \"29s\", \"value\": 29}, {\"label\": \"30s\", \"value\": 30}]}, {\"key\": \"resolution\", \"type\": \"enum\", \"label\": \"分辨率\", \"default\": \"720p\", \"options\": [{\"label\": \"480P\", \"value\": \"480p\"}, {\"label\": \"720P\", \"value\": \"720p\"}, {\"label\": \"1080P\", \"value\": \"1080p\"}]}, {\"key\": \"size\", \"type\": \"enum\", \"label\": \"画幅\", \"default\": \"16:9\", \"options\": [{\"label\": \"16:9\", \"value\": \"16:9\", \"aspectRatio\": \"16:9\", \"orientation\": \"landscape\"}, {\"label\": \"9:16\", \"value\": \"9:16\", \"aspectRatio\": \"9:16\", \"orientation\": \"portrait\"}, {\"label\": \"1:1\", \"value\": \"1:1\", \"aspectRatio\": \"1:1\"}, {\"label\": \"4:3\", \"value\": \"4:3\", \"aspectRatio\": \"4:3\", \"orientation\": \"landscape\"}, {\"label\": \"3:4\", \"value\": \"3:4\", \"aspectRatio\": \"3:4\", \"orientation\": \"portrait\"}, {\"label\": \"21:9\", \"value\": \"21:9\", \"aspectRatio\": \"21:9\", \"orientation\": \"landscape\"}]}, {\"key\": \"reference_images\", \"max\": 10, \"min\": 0, \"type\": \"integer\", \"label\": \"参考图上限\", \"scope\": \"capability\", \"default\": 0}, {\"key\": \"reference_videos\", \"max\": 5, \"min\": 0, \"type\": \"integer\", \"label\": \"参考视频上限\", \"scope\": \"capability\", \"default\": 0}, {\"key\": \"reference_video_duration_seconds\", \"max\": 15, \"min\": 1, \"type\": \"float\", \"label\": \"参考视频时长上限\", \"scope\": \"capability\"}, {\"key\": \"reference_audios\", \"max\": 5, \"min\": 0, \"type\": \"integer\", \"label\": \"参考音频上限\", \"scope\": \"capability\", \"default\": 0}, {\"key\": \"reference_audio_duration_seconds\", \"max\": 15, \"min\": 1, \"type\": \"float\", \"label\": \"单条参考音频时长上限\", \"scope\": \"capability\"}, {\"key\": \"reference_audio_total_duration_seconds\", \"max\": 15, \"min\": 1, \"type\": \"float\", \"label\": \"参考音频总时长上限\", \"scope\": \"capability\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":3.5999999999999996,"model_ratio":0,"completion_ratio":0,"cache_ratio":0,"create_cache_ratio":0}}'::jsonb);

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind,
  capabilities, status, sync_official, created_time, updated_time, name_rule,
  params_def
)
SELECT
  payload ->> 'model_name',
  NULLIF(payload ->> 'description', ''),
  NULL,
  concat_ws(',', NULLIF(payload ->> 'tags', ''), 'recommended', 'lluban'),
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
FROM lluban_model_snapshot
CROSS JOIN (
  SELECT id FROM vendors
  WHERE name = 'Lluban API' AND deleted_at IS NULL
) AS vendor
WHERE NOT EXISTS (
  SELECT 1 FROM models
  WHERE model_name = payload ->> 'model_name' AND deleted_at IS NULL
);

UPDATE models AS model
SET
  description = NULLIF(snapshot.payload ->> 'description', ''),
  tags = concat_ws(',', NULLIF(snapshot.payload ->> 'tags', ''), 'recommended', 'lluban'),
  vendor_id = vendor.id,
  endpoints = (snapshot.payload -> 'endpoints')::text,
  kind = snapshot.payload ->> 'kind',
  capabilities = COALESCE(NULLIF(snapshot.payload ->> 'capabilities', ''), '[]'),
  params_def = snapshot.payload ->> 'params_def',
  name_rule = COALESCE((snapshot.payload ->> 'name_rule')::integer, 0),
  status = 1,
  sync_official = 0,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM lluban_model_snapshot AS snapshot
CROSS JOIN (
  SELECT id FROM vendors
  WHERE name = 'Lluban API' AND deleted_at IS NULL
) AS vendor
WHERE model.model_name = snapshot.payload ->> 'model_name'
  AND model.deleted_at IS NULL;

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  priority, weight, tag, setting, test_model, settings, created_time
)
SELECT
  'lluban-recommended',
  75,
  'default',
  'deepseek-v4.1-flash,doubao-seed-2-0-lite-260428,doubao-seed-2-1-lite-260915,doubao-seed-2-1-pro-260915,doubao-seed-2-1-turbo-260628,doubao-seedance-2.0,doubao-seedance-2.0-fast,doubao-seedance-2.5,gemini-3.1-flash-image-preview-ultra,gemini-3.8-flash,gemini-4-argon,glm-5.3-flash,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-6-astra,gpt-6-luna,gpt-6-sol,gpt-6.1-sol,minimax-h3,qwen3.8-flash,wan3.0-video',
  '{}',
  1,
  'https://tt-api.lluban.com',
  'sk-7Ql7ktfLXeJ2e5mZ1gzfic3R9ylaApgIGWTEFS1e39C9eU6I',
  100,
  100,
  'lluban',
  '{"default_protocol":{"protocol":"openai"},"model_protocols":{"deepseek-v4.1-flash":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seed-2-0-lite-260428":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seed-2-1-lite-260915":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seed-2-1-pro-260915":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seed-2-1-turbo-260628":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seedance-2.0":{"protocol":"task.openai-video"},"doubao-seedance-2.0-fast":{"protocol":"task.openai-video"},"doubao-seedance-2.5":{"protocol":"task.openai-video"},"gemini-3.1-flash-image-preview-ultra":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gemini-3.8-flash":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gemini-4-argon":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"glm-5.3-flash":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-5.6-luna":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-5.6-sol":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-5.6-terra":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-6-astra":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-6-luna":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-6-sol":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-6.1-sol":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"minimax-h3":{"protocol":"task.openai-video"},"qwen3.8-flash":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"wan3.0-video":{"protocol":"task.openai-video"}},"force_format":false,"thinking_to_content":false,"proxy":"","pass_through_body_enabled":false,"system_prompt":"","system_prompt_override":false}',
  'gpt-5.6-luna',
  '{"upstream_model_update_check_enabled":true,"upstream_model_update_auto_sync_enabled":false,"upstream_model_update_last_check_time":0,"upstream_model_update_last_detected_models":[],"upstream_model_update_ignored_models":[]}',
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'lluban-recommended'
);

UPDATE channels
SET
  type = 75,
  "group" = 'default',
  models = 'deepseek-v4.1-flash,doubao-seed-2-0-lite-260428,doubao-seed-2-1-lite-260915,doubao-seed-2-1-pro-260915,doubao-seed-2-1-turbo-260628,doubao-seedance-2.0,doubao-seedance-2.0-fast,doubao-seedance-2.5,gemini-3.1-flash-image-preview-ultra,gemini-3.8-flash,gemini-4-argon,glm-5.3-flash,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-6-astra,gpt-6-luna,gpt-6-sol,gpt-6.1-sol,minimax-h3,qwen3.8-flash,wan3.0-video',
  model_mapping = '{}',
  base_url = 'https://tt-api.lluban.com',
  priority = 100,
  weight = 100,
  tag = 'lluban',
  setting = '{"default_protocol":{"protocol":"openai"},"model_protocols":{"deepseek-v4.1-flash":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seed-2-0-lite-260428":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seed-2-1-lite-260915":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seed-2-1-pro-260915":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seed-2-1-turbo-260628":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"doubao-seedance-2.0":{"protocol":"task.openai-video"},"doubao-seedance-2.0-fast":{"protocol":"task.openai-video"},"doubao-seedance-2.5":{"protocol":"task.openai-video"},"gemini-3.1-flash-image-preview-ultra":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gemini-3.8-flash":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gemini-4-argon":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"glm-5.3-flash":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-5.6-luna":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-5.6-sol":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-5.6-terra":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-6-astra":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-6-luna":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-6-sol":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"gpt-6.1-sol":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"minimax-h3":{"protocol":"task.openai-video"},"qwen3.8-flash":{"protocol":"openai","options":{"image_size_transport":"passthrough"}},"wan3.0-video":{"protocol":"task.openai-video"}},"force_format":false,"thinking_to_content":false,"proxy":"","pass_through_body_enabled":false,"system_prompt":"","system_prompt_override":false}',
  test_model = 'gpt-5.6-luna',
  settings = (
    COALESCE(settings, '{}'::text)::jsonb
    || '{"upstream_model_update_check_enabled":true,"upstream_model_update_auto_sync_enabled":false}'::jsonb
  )::text
WHERE name = 'lluban-recommended';

INSERT INTO abilities (
  "group", model, channel_id, enabled, priority, weight, tag
)
SELECT
  'default',
  snapshot.payload ->> 'model_name',
  channel.id,
  channel.status = 1 AND length(btrim(channel.key)) > 0,
  channel.priority,
  channel.weight,
  channel.tag
FROM channels AS channel
CROSS JOIN lluban_model_snapshot AS snapshot
WHERE channel.name = 'lluban-recommended'
ON CONFLICT ("group", model, channel_id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

UPDATE abilities AS ability
SET enabled = false
FROM channels AS channel
WHERE ability.channel_id = channel.id
  AND channel.name = 'lluban-recommended'
  AND ability."group" = 'default'
  AND ability.enabled = true
  AND NOT EXISTS (
    SELECT 1
    FROM lluban_model_snapshot AS snapshot
    WHERE snapshot.payload ->> 'model_name' = ability.model
  );

INSERT INTO options (key, value)
VALUES
  ('ModelRatio', '{"deepseek-v4.1-flash":1.095,"doubao-seed-2-0-lite-260428":0.45,"doubao-seed-2-1-lite-260915":1.2,"doubao-seed-2-1-pro-260915":9,"doubao-seed-2-1-turbo-260628":4.5,"gemini-3.8-flash":2.7375,"gemini-4-argon":7.3,"glm-5.3-flash":0.5475,"gpt-5.6-luna":0.73,"gpt-5.6-sol":14.6,"gpt-5.6-terra":7.3,"gpt-6-astra":36.5,"gpt-6-luna":0.365,"gpt-6-sol":7.3,"gpt-6.1-sol":3.5,"qwen3.8-flash":1.1}'),
  ('CompletionRatio', '{"deepseek-v4.1-flash":4,"doubao-seed-2-0-lite-260428":6,"doubao-seed-2-1-lite-260915":3.375,"doubao-seed-2-1-pro-260915":5,"doubao-seed-2-1-turbo-260628":5,"gemini-3.8-flash":5,"gemini-4-argon":5,"glm-5.3-flash":3.3333333333333335,"gpt-5.6-luna":6,"gpt-5.6-sol":5,"gpt-5.6-terra":6,"gpt-6-astra":5,"gpt-6-luna":5,"gpt-6-sol":5,"gpt-6.1-sol":5,"qwen3.8-flash":4}'),
  ('CacheRatio', '{"deepseek-v4.1-flash":0.02,"doubao-seed-2-0-lite-260428":0.2,"doubao-seed-2-1-lite-260915":0.2,"doubao-seed-2-1-pro-260915":0.2,"doubao-seed-2-1-turbo-260628":0.2,"gemini-3.8-flash":0.1,"gemini-4-argon":0.05,"glm-5.3-flash":0.2,"gpt-5.6-luna":0.09999999999999999,"gpt-5.6-sol":0.1,"gpt-5.6-terra":0.1,"gpt-6-astra":0.09999999999999999,"gpt-6-luna":0.09999999999999999,"gpt-6-sol":0.1,"gpt-6.1-sol":0.05,"qwen3.8-flash":0.02}'),
  ('CreateCacheRatio', '{"doubao-seed-2-0-lite-260428":0,"doubao-seed-2-1-lite-260915":0,"doubao-seed-2-1-pro-260915":0,"doubao-seed-2-1-turbo-260628":0,"gpt-5.6-luna":1.25,"gpt-5.6-sol":1.25,"gpt-5.6-terra":1.25,"gpt-6-astra":1.25,"gpt-6-luna":1.25,"gpt-6-sol":1.25,"gpt-6.1-sol":1.25,"qwen3.8-flash":0}'),
  ('ModelPrice', '{"doubao-seedance-2.0":20,"doubao-seedance-2.0-fast":15,"doubao-seedance-2.5":7.5,"gemini-3.1-flash-image-preview-ultra":0.3,"minimax-h3":0.96,"wan3.0-video":3.5999999999999996}')
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || EXCLUDED.value::jsonb
)::text;

DO $$
DECLARE
  expected_model_count integer;
  enabled_ability_count integer;
  enabled_image_count integer;
  enabled_video_count integer;
BEGIN
  SELECT COUNT(*) INTO expected_model_count FROM lluban_model_snapshot;
  IF expected_model_count <> 22 THEN
    RAISE EXCEPTION 'Lluban snapshot expected 22 models, found %', expected_model_count;
  END IF;

  IF (
    SELECT COUNT(*) FROM vendors
    WHERE name = 'Lluban API' AND status = 1 AND deleted_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Lluban API vendor invariant failed';
  END IF;

  IF (
    SELECT COUNT(*) FROM channels
    WHERE name = 'lluban-recommended'
      AND type = 75
      AND base_url = 'https://tt-api.lluban.com'
  ) <> 1 THEN
    RAISE EXCEPTION 'lluban-recommended channel invariant failed';
  END IF;

  SELECT COUNT(*) INTO enabled_ability_count
  FROM abilities AS ability
  JOIN channels AS channel ON channel.id = ability.channel_id
  JOIN lluban_model_snapshot AS snapshot
    ON snapshot.payload ->> 'model_name' = ability.model
  WHERE channel.name = 'lluban-recommended'
    AND ability."group" = 'default'
    AND ability.enabled = true;
  IF enabled_ability_count <> expected_model_count THEN
    RAISE EXCEPTION 'lluban ability invariant failed: expected %, found %',
      expected_model_count, enabled_ability_count;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM abilities AS ability
    JOIN channels AS channel ON channel.id = ability.channel_id
    WHERE channel.name = 'lluban-recommended'
      AND ability."group" = 'default'
      AND ability.enabled = true
  ) <> expected_model_count THEN
    RAISE EXCEPTION 'lluban published ability count exceeds the verified snapshot';
  END IF;

  SELECT COUNT(*) INTO enabled_image_count
  FROM models AS model
  JOIN lluban_model_snapshot AS snapshot
    ON snapshot.payload ->> 'model_name' = model.model_name
  WHERE model.kind = 'image'
    AND model.status = 1
    AND model.deleted_at IS NULL;
  IF enabled_image_count <> 1 THEN
    RAISE EXCEPTION 'lluban image model invariant failed: expected 1, found %', enabled_image_count;
  END IF;

  SELECT COUNT(*) INTO enabled_video_count
  FROM models AS model
  JOIN lluban_model_snapshot AS snapshot
    ON snapshot.payload ->> 'model_name' = model.model_name
  WHERE model.kind = 'video'
    AND model.status = 1
    AND model.deleted_at IS NULL;
  IF enabled_video_count <> 5 THEN
    RAISE EXCEPTION 'lluban video model invariant failed: expected 5, found %', enabled_video_count;
  END IF;
END
$$;

COMMIT;
