BEGIN;

-- Seed system model catalog and pricing without any API keys.
-- Goal: bootstrap deploys with stable vendor/model/pricing metadata first;
-- later deployments only need to insert rows into model_catalog_vendor_api_keys.

-- Vendors
INSERT INTO model_catalog_vendors (
	key,
	name,
	enabled,
	base_url_hint,
	auth_type,
	auth_header,
	auth_query_param,
	meta,
	created_at,
	updated_at
)
VALUES
	('openai', 'OpenAI', 1, NULL, 'bearer', NULL, NULL, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('anthropic', 'Anthropic', 1, NULL, 'x-api-key', 'x-api-key', NULL, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini', 'Gemini', 1, NULL, 'query', NULL, 'key', NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('qwen', 'Qwen', 1, NULL, 'bearer', NULL, NULL, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo', 'Veo', 1, NULL, 'bearer', NULL, NULL, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

-- Models currently referenced by the app UI/runtime.
INSERT INTO model_catalog_models (
	model_key,
	vendor_key,
	model_alias,
	label_zh,
	kind,
	enabled,
	meta,
	created_at,
	updated_at
)
VALUES
	('gpt-5.2', 'openai', 'gpt-5.2', 'GPT-5.2', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gpt-5.1', 'openai', 'gpt-5.1', 'GPT-5.1', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gpt-5.1-codex', 'openai', 'gpt-5.1-codex', 'GPT-5.1 Codex', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('glm-4.6', 'anthropic', 'glm-4.6', 'GLM-4.6（Claude 兼容）', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('glm-4.5', 'anthropic', 'glm-4.5', 'GLM-4.5', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('glm-4.5-air', 'anthropic', 'glm-4.5-air', 'GLM-4.5-Air', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-flash', 'gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-flash-lite', 'gemini', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-flash-think', 'gemini', 'gemini-2.5-flash-think', 'Gemini 2.5 Flash Think', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-pro', 'gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-3-pro', 'gemini', 'gemini-3-pro', 'Gemini 3 Pro', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('models/gemini-3-pro-preview', 'gemini', 'models/gemini-3-pro-preview', 'Gemini 3 Pro Preview', 'text', 1, NULL, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-3.1-flash-image-preview', 'gemini', 'gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash Image Preview', 'image', 1, '{"imageOptions":{"defaultAspectRatio":"1:1","defaultImageSize":"2K","aspectRatioOptions":["1:1","16:9","9:16","4:3","3:4"],"imageSizeOptions":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}],"resolutionOptions":[{"value":"1K","label":"1K 输出"},{"value":"2K","label":"2K 输出"},{"value":"4K","label":"4K 输出"}],"controls":[{"key":"aspect_ratio","binding":"aspectRatio","label":"比例"},{"key":"image_size","binding":"imageSize","label":"尺寸"},{"key":"resolution","binding":"resolution","label":"分辨率"}],"supportsReferenceImages":true,"supportsTextToImage":true,"supportsImageToImage":true},"useCases":["image_generation","image_edit","vision","reference_guided"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('nano-banana', 'gemini', 'nano-banana', 'Nano Banana', 'image', 1, '{"imageOptions":{"defaultAspectRatio":"1:1","defaultImageSize":"2K","aspectRatioOptions":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"],"imageSizeOptions":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}],"resolutionOptions":[{"value":"1K","label":"1K 输出"},{"value":"2K","label":"2K 输出"},{"value":"4K","label":"4K 输出"}],"controls":[{"key":"aspect_ratio","binding":"aspectRatio","label":"比例"},{"key":"image_size","binding":"imageSize","label":"尺寸"},{"key":"resolution","binding":"resolution","label":"分辨率"}],"supportsReferenceImages":true,"supportsTextToImage":true,"supportsImageToImage":true},"useCases":["image_generation","storyboard_still","character_consistency","reference_guided"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('nano-banana-fast', 'gemini', 'nano-banana-fast', 'Nano Banana Fast', 'image', 1, '{"imageOptions":{"defaultAspectRatio":"1:1","defaultImageSize":"1K","aspectRatioOptions":["1:1","16:9","9:16","4:3","3:4"],"imageSizeOptions":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"}],"resolutionOptions":[{"value":"1K","label":"1K 输出"},{"value":"2K","label":"2K 输出"}],"controls":[{"key":"aspect_ratio","binding":"aspectRatio","label":"比例"},{"key":"image_size","binding":"imageSize","label":"尺寸"},{"key":"resolution","binding":"resolution","label":"分辨率"}],"supportsReferenceImages":true,"supportsTextToImage":true,"supportsImageToImage":true},"useCases":["image_generation","fast_iteration","reference_guided"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('nano-banana-pro', 'gemini', 'nano-banana-pro', 'Nano Banana Pro', 'image', 1, '{"imageOptions":{"defaultAspectRatio":"1:1","defaultImageSize":"2K","aspectRatioOptions":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"],"imageSizeOptions":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}],"resolutionOptions":[{"value":"1K","label":"1K 输出"},{"value":"2K","label":"2K 输出"},{"value":"4K","label":"4K 输出"}],"controls":[{"key":"aspect_ratio","binding":"aspectRatio","label":"比例"},{"key":"image_size","binding":"imageSize","label":"尺寸"},{"key":"resolution","binding":"resolution","label":"分辨率"}],"supportsReferenceImages":true,"supportsTextToImage":true,"supportsImageToImage":true},"useCases":["image_generation","storyboard_still","character_consistency","high_quality","reference_guided"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-flash-image', 'gemini', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', 'image', 1, '{"imageOptions":{"defaultAspectRatio":"1:1","defaultImageSize":"1K","aspectRatioOptions":["1:1","16:9","9:16","4:3","3:4"],"imageSizeOptions":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"}],"controls":[{"key":"aspect_ratio","binding":"aspectRatio","label":"比例"},{"key":"image_size","binding":"imageSize","label":"尺寸"}],"supportsReferenceImages":true,"supportsTextToImage":true,"supportsImageToImage":true},"useCases":["image_generation","vision","fast_iteration"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('qwen-image-plus', 'qwen', 'qwen-image-plus', 'Qwen Image Plus', 'image', 1, '{"imageOptions":{"defaultAspectRatio":"1:1","defaultImageSize":"2K","aspectRatioOptions":["1:1","16:9","9:16","4:3","3:4"],"imageSizeOptions":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}],"controls":[{"key":"aspect_ratio","binding":"aspectRatio","label":"比例"},{"key":"image_size","binding":"imageSize","label":"尺寸"}],"supportsReferenceImages":true,"supportsTextToImage":true,"supportsImageToImage":true},"useCases":["image_generation","strict_size","reference_guided"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-pro', 'veo', 'veo3.1-pro', 'Veo 3.1 Pro', 'video', 1, '{"videoOptions":{"defaultDurationSeconds":5,"defaultResolution":"1080p","durationOptions":[{"value":5,"label":"5s"},{"value":8,"label":"8s"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}],"orientationOptions":[{"value":"landscape","label":"横屏","aspectRatio":"16:9"},{"value":"portrait","label":"竖屏","aspectRatio":"9:16"}],"controls":[{"key":"duration","binding":"durationSeconds","label":"时长"},{"key":"resolution","binding":"resolution","label":"分辨率"},{"key":"orientation","binding":"orientation","label":"方向"}]},"useCases":["text_to_video","image_to_video","cinematic","high_quality"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-fast', 'veo', 'veo3.1-fast', 'Veo 3.1 Fast', 'video', 1, '{"videoOptions":{"defaultDurationSeconds":5,"defaultResolution":"720p","durationOptions":[{"value":5,"label":"5s"},{"value":8,"label":"8s"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}],"orientationOptions":[{"value":"landscape","label":"横屏","aspectRatio":"16:9"},{"value":"portrait","label":"竖屏","aspectRatio":"9:16"}],"controls":[{"key":"duration","binding":"durationSeconds","label":"时长"},{"key":"resolution","binding":"resolution","label":"分辨率"},{"key":"orientation","binding":"orientation","label":"方向"}]},"useCases":["text_to_video","image_to_video","fast_iteration"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo_3_1_i2v_s_fast_fl_landscape', 'veo', 'veo_3_1_i2v_s_fast_fl_landscape', 'Veo 3.1 i2v Fast Landscape', 'video', 1, '{"videoOptions":{"defaultDurationSeconds":5,"defaultResolution":"720p","defaultOrientation":"landscape","durationOptions":[{"value":5,"label":"5s"},{"value":8,"label":"8s"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}],"orientationOptions":[{"value":"landscape","label":"横屏","aspectRatio":"16:9"}],"controls":[{"key":"duration","binding":"durationSeconds","label":"时长"},{"key":"resolution","binding":"resolution","label":"分辨率"}]},"useCases":["image_to_video","first_last_frame","landscape_only"]}', '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z')
ON CONFLICT (vendor_key, model_key) DO NOTHING;

-- Base credit pricing
INSERT INTO model_credit_costs (
	model_key,
	cost,
	enabled,
	created_at,
	updated_at
)
VALUES
	('gpt-5.2', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gpt-5.1', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gpt-5.1-codex', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('glm-4.6', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('glm-4.5', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('glm-4.5-air', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-flash', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-flash-lite', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-flash-think', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-pro', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-3-pro', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-3-pro-preview', 0, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-3.1-flash-image-preview', 1, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('nano-banana', 1, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('nano-banana-fast', 1, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('nano-banana-pro', 2, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('gemini-2.5-flash-image', 1, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('qwen-image-plus', 1, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-pro', 20, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-fast', 10, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo_3_1_i2v_s_fast_fl', 12, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z')
ON CONFLICT (model_key) DO NOTHING;

-- Optional spec-level pricing
INSERT INTO model_credit_cost_specs (
	model_key,
	spec_key,
	cost,
	enabled,
	created_at,
	updated_at
)
VALUES
	('veo3.1-fast', 'duration:5s', 10, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-fast', 'duration:8s', 15, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-fast', 'quality:fast', 10, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-pro', 'duration:5s', 20, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-pro', 'duration:8s', 30, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo3.1-pro', 'quality:pro', 20, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo_3_1_i2v_s_fast_fl', 'duration:5s', 12, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo_3_1_i2v_s_fast_fl', 'duration:8s', 18, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'),
	('veo_3_1_i2v_s_fast_fl', 'orientation:landscape', 12, 1, '2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z')
ON CONFLICT (model_key, spec_key) DO NOTHING;

COMMIT;
