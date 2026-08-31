\set ON_ERROR_STOP on

-- The only TapCanvas new-api data patch.
-- Snapshot source: Lluban /v1/models + /api/models/list + /api/pricing on 2026-08-31.
-- Only the 20-model executable intersection is published: 10 image, 4 video,
-- and 6 text/chat models. Rows without live routing, metadata, or pricing are excluded.
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
  ('{"model_name":"deepseek-v4-flash","description":"DeepSeek V4 Flash — 1M context, dual-mode reasoning, official API","tags":"","endpoints":["openai"],"kind":"chat","capabilities":"[\"function_calling\",\"streaming\",\"thinking\"]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":0.14,"completion_ratio":2,"cache_ratio":0.02,"create_cache_ratio":0}}'::jsonb),
  ('{"model_name":"doubao-seedream-5-0-pro-260628","description":"Doubao Seedream 5.0 Pro — ARK upstream model ID（分辨率 1K/2K，不支持组图）","tags":"","endpoints":["openai","image-generation"],"kind":"image","capabilities":"[]","params_def":"[\n    {\"key\":\"size\",\"type\":\"enum\",\"label\":\"宽高比\",\"default\":\"1:1\",\n     \"options\":[\n       {\"value\":\"1:1\",\"label\":\"1:1\"},{\"value\":\"16:9\",\"label\":\"16:9 横\"},\n       {\"value\":\"9:16\",\"label\":\"9:16 竖\"},{\"value\":\"4:3\",\"label\":\"4:3\"},\n       {\"value\":\"3:4\",\"label\":\"3:4\"},{\"value\":\"3:2\",\"label\":\"3:2\"},\n       {\"value\":\"2:3\",\"label\":\"2:3\"},{\"value\":\"21:9\",\"label\":\"21:9 超宽\"}\n     ]},\n    {\"key\":\"image_size\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"2k\",\n     \"options\":[\n       {\"value\":\"1k\",\"label\":\"1K\"},\n       {\"value\":\"2k\",\"label\":\"2K\"}\n     ]}\n  ]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.5,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gemini-2.5-flash-image-preview","description":"APIMart upstream gemini-2.5-flash-image-preview","tags":"","endpoints":["openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[\n    {\"key\":\"size\",\"type\":\"enum\",\"label\":\"宽高比\",\"default\":\"1:1\",\n     \"options\":[\n       {\"value\":\"1:1\",\"label\":\"1:1\"},\n       {\"value\":\"2:3\",\"label\":\"2:3\"},\n       {\"value\":\"3:2\",\"label\":\"3:2\"},\n       {\"value\":\"3:4\",\"label\":\"3:4\"},\n       {\"value\":\"4:3\",\"label\":\"4:3\"},\n       {\"value\":\"4:5\",\"label\":\"4:5\"},\n       {\"value\":\"5:4\",\"label\":\"5:4\"},\n       {\"value\":\"9:16\",\"label\":\"9:16\"},\n       {\"value\":\"16:9\",\"label\":\"16:9\"},\n       {\"value\":\"21:9\",\"label\":\"21:9\"}\n     ]},\n    {\"key\":\"urls\",\"type\":\"array\",\"item_type\":\"string\",\"label\":\"参考图 URL\",\"scope\":\"per_request\",\n     \"description\":\"可选，图生图参考图 URL 列表\"}\n  ]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.4,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gemini-3-pro-image-lluban-test","description":"Gemini 3 Pro Image — lluban 内测线路","tags":"tapcanvas:kind=image,lluban,test","endpoints":["gemini","openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[\n      {\"key\":\"size\",\"type\":\"enum\",\"label\":\"宽高比\",\"default\":\"1:1\",\"options\":[\n        {\"value\":\"1:1\",\"label\":\"1:1\"},\n        {\"value\":\"16:9\",\"label\":\"16:9 横\"},\n        {\"value\":\"9:16\",\"label\":\"9:16 竖\"},\n        {\"value\":\"4:3\",\"label\":\"4:3\"},\n        {\"value\":\"3:4\",\"label\":\"3:4\"},\n        {\"value\":\"3:2\",\"label\":\"3:2\"},\n        {\"value\":\"2:3\",\"label\":\"2:3\"},\n        {\"value\":\"5:4\",\"label\":\"5:4\"},\n        {\"value\":\"4:5\",\"label\":\"4:5\"},\n        {\"value\":\"21:9\",\"label\":\"21:9\"},\n        {\"value\":\"auto\",\"label\":\"自动\"}\n      ]},\n      {\"key\":\"image_size\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"1K\",\"options\":[\n        {\"value\":\"1K\",\"label\":\"1K\"},\n        {\"value\":\"2K\",\"label\":\"2K\"},\n        {\"value\":\"4K\",\"label\":\"4K\"}\n      ]},\n      {\"key\":\"urls\",\"type\":\"array\",\"item_type\":\"string\",\"label\":\"参考图 URL\",\"scope\":\"per_request\",\"description\":\"可选，图生图参考图 URL 列表\"}\n    ]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.2,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gemini-3-pro-image-preview","description":"APIMart upstream gemini-3-pro-image-preview","tags":"","endpoints":["gemini","openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[\n    {\"key\":\"size\",\"type\":\"enum\",\"label\":\"宽高比\",\"default\":\"1:1\",\n     \"options\":[\n       {\"value\":\"1:1\",\"label\":\"1:1\"},\n       {\"value\":\"2:3\",\"label\":\"2:3\"},\n       {\"value\":\"3:2\",\"label\":\"3:2\"},\n       {\"value\":\"3:4\",\"label\":\"3:4\"},\n       {\"value\":\"4:3\",\"label\":\"4:3\"},\n       {\"value\":\"4:5\",\"label\":\"4:5\"},\n       {\"value\":\"5:4\",\"label\":\"5:4\"},\n       {\"value\":\"9:16\",\"label\":\"9:16\"},\n       {\"value\":\"16:9\",\"label\":\"16:9\"},\n       {\"value\":\"21:9\",\"label\":\"21:9\"}\n     ]},\n    {\"key\":\"image_size\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"1K\",\n     \"options\":[\n       {\"value\":\"1K\",\"label\":\"1K\"},\n       {\"value\":\"2K\",\"label\":\"2K\"},\n       {\"value\":\"4K\",\"label\":\"4K\"}\n     ]},\n    {\"key\":\"urls\",\"type\":\"array\",\"item_type\":\"string\",\"label\":\"参考图 URL\",\"scope\":\"per_request\",\n     \"description\":\"可选，图生图参考图 URL 列表\"}\n  ]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.3,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gemini-3-pro-image-preview-official","description":"APIMart official-priced alias for upstream gemini-3-pro-image-preview","tags":"","endpoints":["openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[\n    {\"key\":\"size\",\"type\":\"enum\",\"label\":\"宽高比\",\"default\":\"1:1\",\n     \"options\":[\n       {\"value\":\"1:1\",\"label\":\"1:1\"},\n       {\"value\":\"2:3\",\"label\":\"2:3\"},\n       {\"value\":\"3:2\",\"label\":\"3:2\"},\n       {\"value\":\"3:4\",\"label\":\"3:4\"},\n       {\"value\":\"4:3\",\"label\":\"4:3\"},\n       {\"value\":\"4:5\",\"label\":\"4:5\"},\n       {\"value\":\"5:4\",\"label\":\"5:4\"},\n       {\"value\":\"9:16\",\"label\":\"9:16\"},\n       {\"value\":\"16:9\",\"label\":\"16:9\"},\n       {\"value\":\"21:9\",\"label\":\"21:9\"}\n     ]},\n    {\"key\":\"image_size\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"1K\",\n     \"options\":[\n       {\"value\":\"1K\",\"label\":\"1K\"},\n       {\"value\":\"2K\",\"label\":\"2K\"},\n       {\"value\":\"4K\",\"label\":\"4K\"}\n     ]},\n    {\"key\":\"urls\",\"type\":\"array\",\"item_type\":\"string\",\"label\":\"参考图 URL\",\"scope\":\"per_request\",\n     \"description\":\"可选，图生图参考图 URL 列表\"}\n  ]","name_rule":0,"pricing":{"quota_type":1,"model_price":1.3,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gemini-3-pro-image-preview-plus","description":"Nano Banana Pro+ via BananaPro; expanded content-support variant","tags":"","endpoints":["gemini","openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[{\"key\": \"size\", \"type\": \"enum\", \"label\": \"宽高比\", \"default\": \"1:1\", \"options\": [{\"label\": \"1:1\", \"value\": \"1:1\"}, {\"label\": \"2:3\", \"value\": \"2:3\"}, {\"label\": \"3:2\", \"value\": \"3:2\"}, {\"label\": \"3:4\", \"value\": \"3:4\"}, {\"label\": \"4:3\", \"value\": \"4:3\"}, {\"label\": \"4:5\", \"value\": \"4:5\"}, {\"label\": \"5:4\", \"value\": \"5:4\"}, {\"label\": \"9:16\", \"value\": \"9:16\"}, {\"label\": \"16:9\", \"value\": \"16:9\"}, {\"label\": \"21:9\", \"value\": \"21:9\"}]}, {\"key\": \"image_size\", \"type\": \"enum\", \"label\": \"分辨率\", \"default\": \"1K\", \"options\": [{\"label\": \"1K\", \"value\": \"1K\"}, {\"label\": \"2K\", \"value\": \"2K\"}, {\"label\": \"4K\", \"value\": \"4K\"}]}, {\"key\": \"urls\", \"type\": \"array\", \"label\": \"参考图 URL\", \"scope\": \"per_request\", \"item_type\": \"string\", \"description\": \"可选，图生图参考图 URL 列表\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.7,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gemini-3.1-flash-image-preview","description":"APIMart upstream gemini-3.1-flash-image-preview","tags":"","endpoints":["gemini","openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[\n    {\"key\":\"size\",\"type\":\"enum\",\"label\":\"宽高比\",\"default\":\"1:1\",\n     \"options\":[\n       {\"value\":\"1:1\",\"label\":\"1:1\"},\n       {\"value\":\"1:4\",\"label\":\"1:4\"},\n       {\"value\":\"1:8\",\"label\":\"1:8\"},\n       {\"value\":\"2:3\",\"label\":\"2:3\"},\n       {\"value\":\"3:2\",\"label\":\"3:2\"},\n       {\"value\":\"3:4\",\"label\":\"3:4\"},\n       {\"value\":\"4:1\",\"label\":\"4:1\"},\n       {\"value\":\"4:3\",\"label\":\"4:3\"},\n       {\"value\":\"4:5\",\"label\":\"4:5\"},\n       {\"value\":\"5:4\",\"label\":\"5:4\"},\n       {\"value\":\"8:1\",\"label\":\"8:1\"},\n       {\"value\":\"9:16\",\"label\":\"9:16\"},\n       {\"value\":\"16:9\",\"label\":\"16:9\"},\n       {\"value\":\"21:9\",\"label\":\"21:9\"}\n     ]},\n    {\"key\":\"image_size\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"1K\",\n     \"options\":[\n       {\"value\":\"512\",\"label\":\"512\"},\n       {\"value\":\"1K\",\"label\":\"1K\"},\n       {\"value\":\"2K\",\"label\":\"2K\"},\n       {\"value\":\"4K\",\"label\":\"4K\"}\n     ]},\n    {\"key\":\"urls\",\"type\":\"array\",\"item_type\":\"string\",\"label\":\"参考图 URL\",\"scope\":\"per_request\",\n     \"description\":\"可选，图生图参考图 URL 列表\"}\n  ]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.3,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gemini-3.1-flash-image-preview-plus","description":"Nano Banana 2+ via BananaPro; expanded content-support variant","tags":"","endpoints":["gemini","openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[{\"key\": \"size\", \"type\": \"enum\", \"label\": \"宽高比\", \"default\": \"1:1\", \"options\": [{\"label\": \"1:1\", \"value\": \"1:1\"}, {\"label\": \"1:4\", \"value\": \"1:4\"}, {\"label\": \"1:8\", \"value\": \"1:8\"}, {\"label\": \"2:3\", \"value\": \"2:3\"}, {\"label\": \"3:2\", \"value\": \"3:2\"}, {\"label\": \"3:4\", \"value\": \"3:4\"}, {\"label\": \"4:1\", \"value\": \"4:1\"}, {\"label\": \"4:3\", \"value\": \"4:3\"}, {\"label\": \"4:5\", \"value\": \"4:5\"}, {\"label\": \"5:4\", \"value\": \"5:4\"}, {\"label\": \"8:1\", \"value\": \"8:1\"}, {\"label\": \"9:16\", \"value\": \"9:16\"}, {\"label\": \"16:9\", \"value\": \"16:9\"}, {\"label\": \"21:9\", \"value\": \"21:9\"}]}, {\"key\": \"image_size\", \"type\": \"enum\", \"label\": \"分辨率\", \"default\": \"1K\", \"options\": [{\"label\": \"1K\", \"value\": \"1K\"}, {\"label\": \"2K\", \"value\": \"2K\"}, {\"label\": \"4K\", \"value\": \"4K\"}]}, {\"key\": \"urls\", \"type\": \"array\", \"label\": \"参考图 URL\", \"scope\": \"per_request\", \"item_type\": \"string\", \"description\": \"可选，图生图参考图 URL 列表\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.7,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gpt-5.4","description":"Yunwu OpenAI chat upstream gpt-5.4","tags":"","endpoints":["openai","image-generation"],"kind":"chat","capabilities":"[\"vision\",\"function_calling\",\"streaming\"]","params_def":"[\n    {\"key\":\"temperature\",\"type\":\"float\",\"label\":\"温度\",\"min\":0,\"max\":2,\"step\":0.1,\"default\":1},\n    {\"key\":\"max_tokens\",\"type\":\"integer\",\"label\":\"最大输出 Token\",\"min\":1,\"max\":128000},\n    {\"key\":\"top_p\",\"type\":\"float\",\"label\":\"Top P\",\"min\":0,\"max\":1,\"step\":0.05,\"default\":1},\n    {\"key\":\"frequency_penalty\",\"type\":\"float\",\"label\":\"频率惩罚\",\"min\":-2,\"max\":2,\"step\":0.1,\"default\":0},\n    {\"key\":\"presence_penalty\",\"type\":\"float\",\"label\":\"存在惩罚\",\"min\":-2,\"max\":2,\"step\":0.1,\"default\":0},\n    {\"key\":\"image_detail\",\"type\":\"enum\",\"label\":\"图片精度\",\"scope\":\"per_image\",\"default\":\"auto\",\n     \"options\":[{\"value\":\"auto\",\"label\":\"自动\"},{\"value\":\"high\",\"label\":\"高精度\"},{\"value\":\"low\",\"label\":\"低精度\"}]}\n  ]","name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":1,"completion_ratio":6,"cache_ratio":0.1008,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"gpt-5.5","description":"PackyAPI upstream gpt-5.5","tags":"","endpoints":["openai","image-generation"],"kind":"text","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":2,"completion_ratio":6,"cache_ratio":0,"create_cache_ratio":0.1}}'::jsonb),
  ('{"model_name":"gpt-5.6-luna","description":"gpt-5.6-luna via right.codes Codex gateway","tags":"","endpoints":["openai","image-generation"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":1,"completion_ratio":6,"cache_ratio":0,"create_cache_ratio":0.1}}'::jsonb),
  ('{"model_name":"gpt-5.6-sol","description":"gpt-5.6-sol via right.codes Codex gateway","tags":"","endpoints":["openai","image-generation"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":5,"completion_ratio":6,"cache_ratio":0,"create_cache_ratio":0.1}}'::jsonb),
  ('{"model_name":"gpt-5.6-terra","description":"gpt-5.6-terra via right.codes Codex gateway","tags":"","endpoints":["openai","image-generation"],"kind":"chat","capabilities":"[]","params_def":null,"name_rule":0,"pricing":{"quota_type":0,"model_price":0,"model_ratio":2.5,"completion_ratio":6,"cache_ratio":0,"create_cache_ratio":0.1}}'::jsonb),
  ('{"model_name":"gpt-image-2","description":"OpenAI image generation gpt-image-2 — served via comfly proxy","tags":"","endpoints":["openai","openai-response","openai-response-compact","image-generation","embeddings"],"kind":"image","capabilities":"[]","params_def":"[{\"key\": \"size\", \"type\": \"enum\", \"label\": \"宽高比\", \"default\": \"auto\", \"options\": [{\"label\": \"自动\", \"value\": \"auto\"}, {\"label\": \"1:1\", \"value\": \"1:1\"}, {\"label\": \"16:9 横\", \"value\": \"16:9\"}, {\"label\": \"9:16 竖\", \"value\": \"9:16\"}, {\"label\": \"4:3\", \"value\": \"4:3\"}, {\"label\": \"3:4\", \"value\": \"3:4\"}, {\"label\": \"3:2 横\", \"value\": \"3:2\"}, {\"label\": \"2:3 竖\", \"value\": \"2:3\"}, {\"label\": \"5:4\", \"value\": \"5:4\"}, {\"label\": \"4:5\", \"value\": \"4:5\"}, {\"label\": \"21:9 超宽\", \"value\": \"21:9\"}]}, {\"key\": \"image_size\", \"type\": \"enum\", \"label\": \"分辨率\", \"default\": \"1K\", \"options\": [{\"label\": \"1K\", \"value\": \"1K\"}, {\"label\": \"2K\", \"value\": \"2K\"}, {\"label\": \"4K\", \"value\": \"4K\"}]}, {\"key\": \"urls\", \"type\": \"array\", \"label\": \"参考图 URL\", \"scope\": \"per_request\", \"item_type\": \"string\", \"description\": \"可选，用于图生图的参考图 URL 列表\"}, {\"key\": \"quality\", \"type\": \"enum\", \"label\": \"质量\", \"default\": \"low\", \"options\": [{\"label\": \"低画质\", \"value\": \"low\"}, {\"label\": \"标准画质\", \"value\": \"medium\"}, {\"label\": \"高画质\", \"value\": \"high\"}]}]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.2,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"minimax-h3","description":"MiniMax H3 unified text, frame and multimodal-reference video generation via Metaso","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"text_to_video\",\"multimodal_reference\",\"reference_images\",\"reference_videos\",\"reference_audios\",\"reference_audio_requires_visual\",\"exclusive_frame_reference_modes\",\"first_last_frame\"]","params_def":"[\n      {\"key\":\"duration\",\"type\":\"enum\",\"label\":\"时长\",\"default\":5,\n       \"options\":[\n         {\"value\":4,\"label\":\"4s\"},{\"value\":5,\"label\":\"5s\"},{\"value\":6,\"label\":\"6s\"},\n         {\"value\":7,\"label\":\"7s\"},{\"value\":8,\"label\":\"8s\"},{\"value\":9,\"label\":\"9s\"},\n         {\"value\":10,\"label\":\"10s\"},{\"value\":11,\"label\":\"11s\"},{\"value\":12,\"label\":\"12s\"},\n         {\"value\":13,\"label\":\"13s\"},{\"value\":14,\"label\":\"14s\"},{\"value\":15,\"label\":\"15s\"}\n       ]},\n      {\"key\":\"size\",\"type\":\"enum\",\"label\":\"画幅\",\"default\":\"16:9\",\n       \"options\":[\n         {\"value\":\"21:9\",\"label\":\"21:9\",\"aspectRatio\":\"21:9\",\"orientation\":\"landscape\"},\n         {\"value\":\"16:9\",\"label\":\"16:9\",\"aspectRatio\":\"16:9\",\"orientation\":\"landscape\"},\n         {\"value\":\"4:3\",\"label\":\"4:3\",\"aspectRatio\":\"4:3\",\"orientation\":\"landscape\"},\n         {\"value\":\"1:1\",\"label\":\"1:1\",\"aspectRatio\":\"1:1\"},\n         {\"value\":\"3:4\",\"label\":\"3:4\",\"aspectRatio\":\"3:4\",\"orientation\":\"portrait\"},\n         {\"value\":\"9:16\",\"label\":\"9:16\",\"aspectRatio\":\"9:16\",\"orientation\":\"portrait\"}\n       ]},\n      {\"key\":\"resolution\",\"type\":\"enum\",\"label\":\"分辨率\",\"default\":\"768p\",\n       \"options\":[{\"value\":\"768p\",\"label\":\"768P\"},{\"value\":\"1440p\",\"label\":\"1440P\"}]},\n      {\"key\":\"reference_images\",\"type\":\"integer\",\"label\":\"参考图片\",\"max\":9},\n      {\"key\":\"reference_videos\",\"type\":\"integer\",\"label\":\"参考视频\",\"max\":3},\n      {\"key\":\"reference_audios\",\"type\":\"integer\",\"label\":\"参考音频\",\"max\":3},\n      {\"key\":\"reference_media\",\"type\":\"integer\",\"label\":\"参考媒体总数\",\"max\":12},\n      {\"key\":\"reference_video_duration_seconds\",\"type\":\"integer\",\"label\":\"参考视频总时长\",\"max\":15},\n      {\"key\":\"reference_audio_duration_seconds\",\"type\":\"integer\",\"label\":\"参考音频总时长\",\"max\":15}\n    ]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.96,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"sd2","description":"Megaby Seedance 2.0 video generation; provider ID selected by resolution","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"text_to_video\",\"multimodal_reference\",\"reference_images\",\"reference_videos\",\"reference_audios\"]","params_def":"[{\"key\": \"duration\", \"type\": \"enum\", \"label\": \"时长\", \"default\": 5, \"options\": [{\"label\": \"4s\", \"value\": 4}, {\"label\": \"5s\", \"value\": 5}, {\"label\": \"6s\", \"value\": 6}, {\"label\": \"7s\", \"value\": 7}, {\"label\": \"8s\", \"value\": 8}, {\"label\": \"9s\", \"value\": 9}, {\"label\": \"10s\", \"value\": 10}, {\"label\": \"11s\", \"value\": 11}, {\"label\": \"12s\", \"value\": 12}, {\"label\": \"13s\", \"value\": 13}, {\"label\": \"14s\", \"value\": 14}, {\"label\": \"15s\", \"value\": 15}]}, {\"key\": \"size\", \"type\": \"enum\", \"label\": \"画幅\", \"default\": \"16:9\", \"options\": [{\"label\": \"16:9\", \"value\": \"16:9\", \"aspectRatio\": \"16:9\", \"orientation\": \"landscape\"}, {\"label\": \"1:1\", \"value\": \"1:1\", \"aspectRatio\": \"1:1\"}, {\"label\": \"9:16\", \"value\": \"9:16\", \"aspectRatio\": \"9:16\", \"orientation\": \"portrait\"}]}, {\"key\": \"resolution\", \"type\": \"enum\", \"label\": \"分辨率\", \"default\": \"720p\", \"options\": [{\"label\": \"480P\", \"value\": \"480p\"}, {\"label\": \"720P\", \"value\": \"720p\"}, {\"label\": \"1080P\", \"value\": \"1080p\"}, {\"label\": \"4K\", \"value\": \"4k\"}]}, {\"key\": \"reference_images\", \"max\": 9, \"type\": \"integer\", \"label\": \"参考图片\"}, {\"key\": \"reference_videos\", \"max\": 3, \"type\": \"integer\", \"label\": \"参考视频\"}, {\"key\": \"reference_audios\", \"max\": 3, \"type\": \"integer\", \"label\": \"参考音频\"}, {\"key\": \"reference_video_duration_seconds\", \"max\": 15, \"type\": \"integer\", \"label\": \"参考视频总时长\"}, {\"key\": \"reference_audio_duration_seconds\", \"max\": 15, \"type\": \"integer\", \"label\": \"参考音频总时长\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":3.5714285714285716,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"sd2-mini","description":"Megaby Seedance Mini video generation; provider ID selected by resolution","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"text_to_video\",\"multimodal_reference\",\"reference_images\",\"reference_videos\",\"reference_audios\"]","params_def":"[{\"key\": \"duration\", \"type\": \"enum\", \"label\": \"时长\", \"default\": 5, \"options\": [{\"label\": \"4s\", \"value\": 4}, {\"label\": \"5s\", \"value\": 5}, {\"label\": \"6s\", \"value\": 6}, {\"label\": \"7s\", \"value\": 7}, {\"label\": \"8s\", \"value\": 8}, {\"label\": \"9s\", \"value\": 9}, {\"label\": \"10s\", \"value\": 10}, {\"label\": \"11s\", \"value\": 11}, {\"label\": \"12s\", \"value\": 12}, {\"label\": \"13s\", \"value\": 13}, {\"label\": \"14s\", \"value\": 14}, {\"label\": \"15s\", \"value\": 15}]}, {\"key\": \"size\", \"type\": \"enum\", \"label\": \"画幅\", \"default\": \"16:9\", \"options\": [{\"label\": \"16:9\", \"value\": \"16:9\", \"aspectRatio\": \"16:9\", \"orientation\": \"landscape\"}, {\"label\": \"1:1\", \"value\": \"1:1\", \"aspectRatio\": \"1:1\"}, {\"label\": \"9:16\", \"value\": \"9:16\", \"aspectRatio\": \"9:16\", \"orientation\": \"portrait\"}]}, {\"key\": \"resolution\", \"type\": \"enum\", \"label\": \"分辨率\", \"default\": \"720p\", \"options\": [{\"label\": \"480P\", \"value\": \"480p\"}, {\"label\": \"720P\", \"value\": \"720p\"}]}, {\"key\": \"reference_images\", \"max\": 9, \"type\": \"integer\", \"label\": \"参考图片\"}, {\"key\": \"reference_videos\", \"max\": 3, \"type\": \"integer\", \"label\": \"参考视频\"}, {\"key\": \"reference_audios\", \"max\": 3, \"type\": \"integer\", \"label\": \"参考音频\"}, {\"key\": \"reference_video_duration_seconds\", \"max\": 15, \"type\": \"integer\", \"label\": \"参考视频总时长\"}, {\"key\": \"reference_audio_duration_seconds\", \"max\": 15, \"type\": \"integer\", \"label\": \"参考音频总时长\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":1.8285714285714287,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"seedance-2.5","description":"Megaby Seedance 2.5 multimodal video generation","tags":"","endpoints":["openai-video"],"kind":"video","capabilities":"[\"text_to_video\",\"multimodal_reference\",\"reference_images\",\"reference_videos\",\"reference_audios\"]","params_def":"[{\"key\": \"duration\", \"type\": \"enum\", \"label\": \"时长\", \"default\": 5, \"options\": [{\"label\": \"4s\", \"value\": 4}, {\"label\": \"5s\", \"value\": 5}, {\"label\": \"6s\", \"value\": 6}, {\"label\": \"7s\", \"value\": 7}, {\"label\": \"8s\", \"value\": 8}, {\"label\": \"9s\", \"value\": 9}, {\"label\": \"10s\", \"value\": 10}, {\"label\": \"11s\", \"value\": 11}, {\"label\": \"12s\", \"value\": 12}, {\"label\": \"13s\", \"value\": 13}, {\"label\": \"14s\", \"value\": 14}, {\"label\": \"15s\", \"value\": 15}]}, {\"key\": \"size\", \"type\": \"enum\", \"label\": \"画幅\", \"default\": \"16:9\", \"options\": [{\"label\": \"16:9\", \"value\": \"16:9\", \"aspectRatio\": \"16:9\", \"orientation\": \"landscape\"}, {\"label\": \"1:1\", \"value\": \"1:1\", \"aspectRatio\": \"1:1\"}, {\"label\": \"9:16\", \"value\": \"9:16\", \"aspectRatio\": \"9:16\", \"orientation\": \"portrait\"}]}, {\"key\": \"resolution\", \"type\": \"enum\", \"label\": \"分辨率\", \"default\": \"720p\", \"options\": [{\"label\": \"480P\", \"value\": \"480p\"}, {\"label\": \"720P\", \"value\": \"720p\"}]}, {\"key\": \"reference_images\", \"max\": 30, \"type\": \"integer\", \"label\": \"参考图片\"}, {\"key\": \"reference_videos\", \"max\": 10, \"type\": \"integer\", \"label\": \"参考视频\"}, {\"key\": \"reference_audios\", \"max\": 10, \"type\": \"integer\", \"label\": \"参考音频\"}, {\"key\": \"reference_media\", \"max\": 50, \"type\": \"integer\", \"label\": \"参考素材总数\"}]","name_rule":0,"pricing":{"quota_type":1,"model_price":2.2285714285714286,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb),
  ('{"model_name":"wan2.7-image-pro","description":"APIMart 万相 wan2.7 图像 wan2.7-image-pro","tags":"","endpoints":["openai","image-generation"],"kind":"image","capabilities":"[\"reference_images\"]","params_def":"[\n      {\n        \"key\": \"size\",\n        \"type\": \"enum\",\n        \"label\": \"比例\",\n        \"default\": \"1:1\",\n        \"options\": [\n          {\"value\": \"1:1\", \"label\": \"1:1\"},\n          {\"value\": \"16:9\", \"label\": \"16:9 横\"},\n          {\"value\": \"9:16\", \"label\": \"9:16 竖\"},\n          {\"value\": \"4:3\", \"label\": \"4:3 横\"},\n          {\"value\": \"3:4\", \"label\": \"3:4 竖\"},\n          {\"value\": \"3:2\", \"label\": \"3:2 横\"},\n          {\"value\": \"2:3\", \"label\": \"2:3 竖\"}\n        ]\n      },\n      {\n        \"key\": \"image_size\",\n        \"type\": \"enum\",\n        \"label\": \"尺寸\",\n        \"default\": \"2K\",\n        \"options\": [\n          {\"value\": \"1K\", \"label\": \"1K\"},\n          {\"value\": \"2K\", \"label\": \"2K\"}\n        ]\n      },\n      {\n        \"key\": \"urls\",\n        \"type\": \"array\",\n        \"item_type\": \"string\",\n        \"label\": \"参考图 URL\",\n        \"scope\": \"per_request\",\n        \"description\": \"可选，用于图生图的参考图 URL 列表（最多 9 张）\"\n      }\n    ]","name_rule":0,"pricing":{"quota_type":1,"model_price":0.79,"model_ratio":0,"completion_ratio":0,"cache_ratio":null,"create_cache_ratio":null}}'::jsonb);

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
  'deepseek-v4-flash,doubao-seedream-5-0-pro-260628,gemini-2.5-flash-image-preview,gemini-3-pro-image-lluban-test,gemini-3-pro-image-preview,gemini-3-pro-image-preview-official,gemini-3-pro-image-preview-plus,gemini-3.1-flash-image-preview,gemini-3.1-flash-image-preview-plus,gpt-5.4,gpt-5.5,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-image-2,minimax-h3,sd2,sd2-mini,seedance-2.5,wan2.7-image-pro',
  '{}',
  1,
  'https://tt-api.lluban.com',
  'sk-7Ql7ktfLXeJ2e5mZ1gzfic3R9ylaApgIGWTEFS1e39C9eU6I',
  100,
  100,
  'lluban',
  '{"default_protocol":{"protocol":"openai"},"model_protocols":{"minimax-h3":{"protocol":"task.openai-video"},"sd2":{"protocol":"task.openai-video"},"sd2-mini":{"protocol":"task.openai-video"},"seedance-2.5":{"protocol":"task.openai-video"}},"force_format":false,"thinking_to_content":false,"proxy":"","pass_through_body_enabled":false,"system_prompt":"","system_prompt_override":false}',
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
  models = 'deepseek-v4-flash,doubao-seedream-5-0-pro-260628,gemini-2.5-flash-image-preview,gemini-3-pro-image-lluban-test,gemini-3-pro-image-preview,gemini-3-pro-image-preview-official,gemini-3-pro-image-preview-plus,gemini-3.1-flash-image-preview,gemini-3.1-flash-image-preview-plus,gpt-5.4,gpt-5.5,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-image-2,minimax-h3,sd2,sd2-mini,seedance-2.5,wan2.7-image-pro',
  model_mapping = '{}',
  base_url = 'https://tt-api.lluban.com',
  priority = 100,
  weight = 100,
  tag = 'lluban',
  setting = '{"default_protocol":{"protocol":"openai"},"model_protocols":{"minimax-h3":{"protocol":"task.openai-video"},"sd2":{"protocol":"task.openai-video"},"sd2-mini":{"protocol":"task.openai-video"},"seedance-2.5":{"protocol":"task.openai-video"}},"force_format":false,"thinking_to_content":false,"proxy":"","pass_through_body_enabled":false,"system_prompt":"","system_prompt_override":false}',
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
  ('ModelRatio', '{"deepseek-v4-flash":0.14,"gpt-5.4":1,"gpt-5.5":2,"gpt-5.6-luna":1,"gpt-5.6-sol":5,"gpt-5.6-terra":2.5}'),
  ('CompletionRatio', '{"deepseek-v4-flash":2,"gpt-5.4":6,"gpt-5.5":6,"gpt-5.6-luna":6,"gpt-5.6-sol":6,"gpt-5.6-terra":6}'),
  ('CacheRatio', '{"deepseek-v4-flash":0.02,"gpt-5.4":0.1008}'),
  ('CreateCacheRatio', '{"gpt-5.5":0.1,"gpt-5.6-luna":0.1,"gpt-5.6-sol":0.1,"gpt-5.6-terra":0.1}'),
  ('ModelPrice', '{"doubao-seedream-5-0-pro-260628":0.5,"gemini-2.5-flash-image-preview":0.4,"gemini-3-pro-image-lluban-test":0.2,"gemini-3-pro-image-preview":0.3,"gemini-3-pro-image-preview-official":1.3,"gemini-3-pro-image-preview-plus":0.7,"gemini-3.1-flash-image-preview":0.3,"gemini-3.1-flash-image-preview-plus":0.7,"gpt-image-2":0.2,"minimax-h3":0.96,"sd2":3.5714285714285716,"sd2-mini":1.8285714285714287,"seedance-2.5":2.2285714285714286,"wan2.7-image-pro":0.79}')
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
  IF expected_model_count <> 20 THEN
    RAISE EXCEPTION 'Lluban snapshot expected 20 models, found %', expected_model_count;
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
  IF enabled_image_count <> 10 THEN
    RAISE EXCEPTION 'lluban image model invariant failed: expected 10, found %', enabled_image_count;
  END IF;

  SELECT COUNT(*) INTO enabled_video_count
  FROM models AS model
  JOIN lluban_model_snapshot AS snapshot
    ON snapshot.payload ->> 'model_name' = model.model_name
  WHERE model.kind = 'video'
    AND model.status = 1
    AND model.deleted_at IS NULL;
  IF enabled_video_count <> 4 THEN
    RAISE EXCEPTION 'lluban video model invariant failed: expected 4, found %', enabled_video_count;
  END IF;
END
$$;

COMMIT;
