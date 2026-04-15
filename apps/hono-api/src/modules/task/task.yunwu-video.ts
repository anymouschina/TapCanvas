import type { TaskKind } from "./task.schemas";

const YUNWU_KLING_OMNI_MODELS = new Set(["kling-video-o1", "kling-v3-omni"]);

type YunwuAspectRatio = "16:9" | "9:16" | "1:1";

export type YunwuKlingImageItem = {
	image_url: string;
	type?: "first_frame" | "end_frame";
};

function asTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPathValue(
	root: unknown,
	path: ReadonlyArray<string | number>,
): unknown {
	let current: unknown = root;
	for (const segment of path) {
		if (typeof segment === "number") {
			if (!Array.isArray(current)) return undefined;
			current = current[segment];
			continue;
		}
		if (!isRecord(current)) return undefined;
		current = current[segment];
	}
	return current;
}

function firstNonEmptyString(
	root: unknown,
	paths: ReadonlyArray<ReadonlyArray<string | number>>,
): string | null {
	for (const path of paths) {
		const value = asTrimmedString(getPathValue(root, path));
		if (value) return value;
	}
	return null;
}

export function isYunwuKlingOmniModel(model: string): boolean {
	return YUNWU_KLING_OMNI_MODELS.has(asTrimmedString(model).toLowerCase());
}

export function extractYunwuModelFromVendorRef(vendor: string): string | null {
	const raw = asTrimmedString(vendor).toLowerCase();
	if (!raw) return null;
	if (raw.startsWith("yunwu-")) return raw.slice("yunwu-".length) || null;
	if (raw.startsWith("yunwu:")) return raw.slice("yunwu:".length) || null;
	return raw === "yunwu" ? null : null;
}

export function inferYunwuAspectRatio(input: {
	aspectRatio?: string | null;
	size?: string | null;
	orientation?: "portrait" | "landscape" | null;
}): YunwuAspectRatio {
	const aspectRatio = asTrimmedString(input.aspectRatio).replace(/\s+/g, "");
	if (
		aspectRatio === "16:9" ||
		aspectRatio === "9:16" ||
		aspectRatio === "1:1"
	) {
		return aspectRatio;
	}

	const size = asTrimmedString(input.size).replace(/\s+/g, "");
	const match = size.match(/^(\d+)x(\d+)$/i);
	if (match && match[1] && match[2]) {
		const width = Number(match[1]);
		const height = Number(match[2]);
		if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
			if (width === height) return "1:1";
			return width > height ? "16:9" : "9:16";
		}
	}

	return input.orientation === "portrait" ? "9:16" : "16:9";
}

export function normalizeYunwuKlingDurationSeconds(input: {
	model: string;
	durationSeconds: number;
}): number {
	const model = asTrimmedString(input.model).toLowerCase();
	const duration = Math.max(1, Math.trunc(input.durationSeconds));
	if (model === "kling-video-o1") {
		if (duration !== 5 && duration !== 10) {
			throw new Error("kling-video-o1 目前仅支持 5s 或 10s");
		}
		return duration;
	}
	if (model === "kling-v3-omni") {
		if (duration < 3 || duration > 15) {
			throw new Error("kling-v3-omni 目前仅支持 3s 到 15s");
		}
		return duration;
	}
	return duration;
}

export function buildYunwuKlingImageList(input: {
	kind: TaskKind;
	firstFrameUrl?: string | null;
	lastFrameUrl?: string | null;
	referenceImages?: string[];
}): YunwuKlingImageItem[] {
	const seen = new Set<string>();
	const references = (Array.isArray(input.referenceImages) ? input.referenceImages : [])
		.map((item) => asTrimmedString(item))
		.filter(Boolean)
		.filter((item) => {
			if (seen.has(item)) return false;
			seen.add(item);
			return true;
		});

	const explicitFirstFrame = asTrimmedString(input.firstFrameUrl);
	const explicitLastFrame = asTrimmedString(input.lastFrameUrl);
	const firstFrameUrl =
		explicitFirstFrame ||
		(input.kind === "image_to_video" && references.length > 0 ? references.shift() || "" : "");
	const lastFrameUrl =
		explicitLastFrame && explicitLastFrame !== firstFrameUrl ? explicitLastFrame : "";

	const items: YunwuKlingImageItem[] = [];
	if (firstFrameUrl) {
		items.push({ image_url: firstFrameUrl, type: "first_frame" });
	}
	if (lastFrameUrl && firstFrameUrl) {
		items.push({ image_url: lastFrameUrl, type: "end_frame" });
	}
	for (const imageUrl of references) {
		if (imageUrl === firstFrameUrl || imageUrl === lastFrameUrl) continue;
		items.push({ image_url: imageUrl });
	}
	return items;
}

export function extractYunwuKlingTaskStatus(payload: unknown): string | null {
	return firstNonEmptyString(payload, [
		["task_status"],
		["status"],
		["data", "task_status"],
		["data", "status"],
		["task", "task_status"],
		["task", "status"],
		["data", "task", "task_status"],
		["data", "task", "status"],
	]);
}

export function extractYunwuKlingVideoUrl(payload: unknown): string | null {
	return firstNonEmptyString(payload, [
		["video_url"],
		["videoUrl"],
		["url"],
		["task_result", "videos", 0, "url"],
		["data", "video_url"],
		["data", "videoUrl"],
		["data", "url"],
		["data", "task_result", "videos", 0, "url"],
		["works", 0, "video_url"],
		["works", 0, "videoUrl"],
		["works", 0, "url"],
		["works", 0, "video", "url"],
		["works", 0, "video", "video_url"],
		["works", 0, "resource", "url"],
		["works", 0, "resource", "video_url"],
		["data", "works", 0, "video_url"],
		["data", "works", 0, "videoUrl"],
		["data", "works", 0, "url"],
		["data", "works", 0, "video", "url"],
		["data", "works", 0, "video", "video_url"],
		["data", "works", 0, "resource", "url"],
		["data", "works", 0, "resource", "video_url"],
	]);
}
