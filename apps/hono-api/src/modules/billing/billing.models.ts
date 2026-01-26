export type BillingModelKind = "text" | "image" | "video";

export type BillingModelCatalogItem = {
	modelKey: string;
	labelZh: string;
	kind: BillingModelKind;
	vendor?: string;
	defaultCost: number;
};

function stripModelsPrefix(modelKey: string): string {
	const raw = (modelKey || "").trim();
	if (!raw) return "";
	return raw.startsWith("models/") ? raw.slice(7) : raw;
}

function stripOrientationSegments(modelKey: string): string {
	let key = (modelKey || "").trim();
	if (!key) return "";

	// Treat landscape/portrait as parameter variants (not different models).
	key = key.replace(/-landscape(?=-|$)/g, "");
	key = key.replace(/-portrait(?=-|$)/g, "");
	key = key.replace(/_landscape(?=_|$)/g, "");
	key = key.replace(/_portrait(?=_|$)/g, "");

	// Cleanup duplicated separators that may appear after stripping.
	key = key.replace(/--+/g, "-").replace(/__+/g, "_");
	key = key.replace(/^-+/, "").replace(/-+$/, "");
	key = key.replace(/^_+/, "").replace(/_+$/, "");

	return key;
}

function item(input: Omit<BillingModelCatalogItem, "modelKey"> & { modelKey: string }) {
	return {
		...input,
		modelKey: stripModelsPrefix(input.modelKey),
	};
}

// Model catalog for admin dropdowns + default credit costs.
// NOTE: modelKey is normalized (strip leading "models/").
export const BILLING_MODEL_CATALOG: BillingModelCatalogItem[] = [
	// ---- Text ----
	item({ modelKey: "gpt-5.2", labelZh: "GPT-5.2", kind: "text", vendor: "openai", defaultCost: 0 }),
	item({ modelKey: "gpt-5.1", labelZh: "GPT-5.1", kind: "text", vendor: "openai", defaultCost: 0 }),
	item({ modelKey: "gpt-5.1-codex", labelZh: "GPT-5.1 Codex", kind: "text", vendor: "openai", defaultCost: 0 }),
	item({ modelKey: "glm-4.6", labelZh: "GLM-4.6（Claude 兼容）", kind: "text", vendor: "anthropic", defaultCost: 0 }),
	item({ modelKey: "glm-4.5", labelZh: "GLM-4.5", kind: "text", vendor: "anthropic", defaultCost: 0 }),
	item({ modelKey: "glm-4.5-air", labelZh: "GLM-4.5-Air", kind: "text", vendor: "anthropic", defaultCost: 0 }),
	item({ modelKey: "gemini-2.5-flash", labelZh: "Gemini 2.5 Flash", kind: "text", vendor: "gemini", defaultCost: 0 }),
	item({ modelKey: "gemini-2.5-flash-lite", labelZh: "Gemini 2.5 Flash Lite", kind: "text", vendor: "gemini", defaultCost: 0 }),
	item({ modelKey: "gemini-2.5-flash-think", labelZh: "Gemini 2.5 Flash Think", kind: "text", vendor: "gemini", defaultCost: 0 }),
	item({ modelKey: "gemini-2.5-pro", labelZh: "Gemini 2.5 Pro", kind: "text", vendor: "gemini", defaultCost: 0 }),
	item({ modelKey: "gemini-3-pro", labelZh: "Gemini 3 Pro", kind: "text", vendor: "gemini", defaultCost: 0 }),
	item({ modelKey: "models/gemini-3-pro-preview", labelZh: "Gemini 3 Pro 预览", kind: "text", vendor: "gemini", defaultCost: 0 }),

	// ---- Image ----
	item({ modelKey: "nano-banana", labelZh: "Nano Banana（标准）", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "nano-banana-fast", labelZh: "Nano Banana（快速）", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "nano-banana-pro", labelZh: "Nano Banana Pro（高质）", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "qwen-image-plus", labelZh: "Qwen Image Plus（通义万相）", kind: "image", vendor: "qwen", defaultCost: 1 }),
	item({ modelKey: "sora-image", labelZh: "Sora 图片（GPT Image 1）", kind: "image", vendor: "sora2api", defaultCost: 1 }),
	item({ modelKey: "sora-image-landscape", labelZh: "Sora 图片（横屏）", kind: "image", vendor: "sora2api", defaultCost: 1 }),
	item({ modelKey: "sora-image-portrait", labelZh: "Sora 图片（竖屏）", kind: "image", vendor: "sora2api", defaultCost: 1 }),

	// Sora2API OpenAI-compatible gateways sometimes use these model ids
	item({ modelKey: "gemini-2.5-flash-image", labelZh: "Gemini Flash Image", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "gemini-2.5-flash-image-landscape", labelZh: "Gemini Flash Image（横屏）", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "gemini-2.5-flash-image-portrait", labelZh: "Gemini Flash Image（竖屏）", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "gemini-3.0-pro-image-landscape", labelZh: "Gemini 3 Pro Image（横屏）", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "gemini-3.0-pro-image-portrait", labelZh: "Gemini 3 Pro Image（竖屏）", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "imagen-4.0-generate-preview-landscape", labelZh: "Imagen 4 预览（横屏）", kind: "image", vendor: "gemini", defaultCost: 1 }),
	item({ modelKey: "imagen-4.0-generate-preview-portrait", labelZh: "Imagen 4 预览（竖屏）", kind: "image", vendor: "gemini", defaultCost: 1 }),

	// ---- Video ----
	item({ modelKey: "sora-2", labelZh: "Sora 2", kind: "video", vendor: "sora2api", defaultCost: 10 }),
	item({ modelKey: "sora-2-pro", labelZh: "Sora 2 Pro", kind: "video", vendor: "sora2api", defaultCost: 10 }),
	item({ modelKey: "sora-video-landscape-10s", labelZh: "Sora 视频（横屏 10s）", kind: "video", vendor: "sora2api", defaultCost: 10 }),
	item({ modelKey: "sora-video-landscape-15s", labelZh: "Sora 视频（横屏 15s）", kind: "video", vendor: "sora2api", defaultCost: 10 }),
	item({ modelKey: "sora-video-portrait-10s", labelZh: "Sora 视频（竖屏 10s）", kind: "video", vendor: "sora2api", defaultCost: 10 }),
	item({ modelKey: "sora-video-portrait-15s", labelZh: "Sora 视频（竖屏 15s）", kind: "video", vendor: "sora2api", defaultCost: 10 }),

	item({ modelKey: "MiniMax-Hailuo-02", labelZh: "海螺 02（MiniMax）", kind: "video", vendor: "minimax", defaultCost: 10 }),
	item({ modelKey: "I2V-01-Director", labelZh: "I2V-01 导演（MiniMax）", kind: "video", vendor: "minimax", defaultCost: 10 }),
	item({ modelKey: "I2V-01-live", labelZh: "I2V-01 Live（MiniMax）", kind: "video", vendor: "minimax", defaultCost: 10 }),
	item({ modelKey: "I2V-01", labelZh: "I2V-01（MiniMax）", kind: "video", vendor: "minimax", defaultCost: 10 }),

	item({ modelKey: "veo3.1-pro", labelZh: "Veo 3.1 Pro", kind: "video", vendor: "veo", defaultCost: 10 }),
	item({ modelKey: "veo3.1-fast", labelZh: "Veo 3.1 Fast", kind: "video", vendor: "veo", defaultCost: 10 }),
	item({ modelKey: "veo_3_1_i2v_s_fast_fl_landscape", labelZh: "Veo 3.1 i2v（快速/FL/横屏）", kind: "video", vendor: "veo", defaultCost: 10 }),
];

export function normalizeBillingModelKey(modelKey: string | null | undefined): string {
	const base = stripModelsPrefix(typeof modelKey === "string" ? modelKey : "");
	return stripOrientationSegments(base);
}
