// Kling motion-control model integration for hono-api → new-api → APIMart.
// Reference: https://docs.apimart.ai/cn/api-reference/videos/kling-v2-6/kling-v2-6-motion-control-generation
//
// The upstream API differs from the standard /v1/videos shape: it requires
// flat `image_url` + `video_url` + `character_orientation` + `mode` fields,
// and ignores resolution/aspect_ratio/duration-from-client. We pass these
// through `metadata` so the APIMart adaptor merges them onto the request.

const KLING_MOTION_CONTROL_MODELS = new Set([
	"kling-v2-6-motion-control",
	"kling-v3-motion-control",
	"kling-motion-control",
]);

export type KlingMotionMode = "std" | "pro";
export type KlingCharacterOrientation = "image" | "video";

export const KLING_MOTION_CONTROL_CANONICAL = "kling-v2-6-motion-control";

function trimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function stripVendorSuffix(model: string): string {
	return model
		.replace(/-(apimart|suchuang|all)$/i, "")
		.toLowerCase();
}

export function isKlingMotionControlModel(model: string): boolean {
	const normalized = stripVendorSuffix(trimmed(model));
	return KLING_MOTION_CONTROL_MODELS.has(normalized);
}

export function normalizeKlingMotionMode(value: unknown): KlingMotionMode {
	const normalized = trimmed(value).toLowerCase();
	return normalized === "pro" ? "pro" : "std";
}

export function normalizeKlingCharacterOrientation(
	value: unknown,
): KlingCharacterOrientation {
	const normalized = trimmed(value).toLowerCase();
	return normalized === "video" ? "video" : "image";
}

export function normalizeKlingKeepOriginalSound(value: unknown): "yes" | "no" {
	if (typeof value === "boolean") return value ? "yes" : "no";
	const normalized = trimmed(value).toLowerCase();
	return normalized === "no" || normalized === "false" || normalized === "0" ? "no" : "yes";
}

export function validateKlingMotionDurationSeconds(input: {
	orientation: KlingCharacterOrientation;
	durationSeconds: number;
}): number {
	const duration = Math.max(1, Math.trunc(input.durationSeconds));
	const max = input.orientation === "video" ? 30 : 10;
	if (duration < 3 || duration > max) {
		throw new Error(
			`kling-v2-6-motion-control character_orientation=${input.orientation} 仅支持 3s 到 ${max}s（收到 ${duration}s）`,
		);
	}
	return duration;
}

export type KlingMotionControlMetadataInput = {
	vendor: string;
	imageUrl: string;
	videoUrl: string;
	mode: KlingMotionMode;
	orientation: KlingCharacterOrientation;
	keepOriginalSound: "yes" | "no";
	watermarkEnabled: boolean;
	durationSeconds?: number;
	negativePrompt?: string;
};

export type KlingMotionControlMetadata = Record<string, unknown> & {
	vendor: string;
	taskKind: "image_to_video";
	image_url: string;
	video_url: string;
	character_orientation: KlingCharacterOrientation;
	mode: KlingMotionMode;
	keep_original_sound: "yes" | "no";
	watermark_info: { enabled: boolean };
};

export function buildKlingMotionControlMetadata(
	input: KlingMotionControlMetadataInput,
): KlingMotionControlMetadata {
	const negative = trimmed(input.negativePrompt);
	return {
		vendor: input.vendor,
		taskKind: "image_to_video",
		image_url: input.imageUrl,
		video_url: input.videoUrl,
		character_orientation: input.orientation,
		mode: input.mode,
		keep_original_sound: input.keepOriginalSound,
		watermark_info: { enabled: input.watermarkEnabled },
		...(typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
			? { duration: input.durationSeconds }
			: {}),
		...(negative ? { negative_prompt: negative } : {}),
	};
}

// Parse mode hint from billing spec_key like `video:std:5s` / `video:pro:10s`.
// Returns null when the key doesn't match the motion-control convention.
export function extractKlingMotionModeFromSpecKey(specKey: unknown): KlingMotionMode | null {
	const raw = trimmed(specKey).toLowerCase();
	if (!raw) return null;
	const match = raw.match(/^video:(std|pro):\d+s$/);
	if (!match || !match[1]) return null;
	return match[1] === "pro" ? "pro" : "std";
}
