import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
	renderHyperframesComposition,
	type HyperframesRenderAsset,
} from "../apiKey/hyperframes-render";

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export type HyperframesRenderToCanvasResult = {
	ok: true;
	videoUrl: string;
	key: string;
	bytes: number;
	durationSec: number | null;
};

/**
 * 剪辑师包装层渲染：把 agent 写好的单文件 HyperFrames composition 渲成 mp4 片段
 * （题卡/动态字幕/片头片尾），返回托管 URL。整片组装仍归 tapcanvas_video_concat。
 */
export async function renderHyperframesToCanvas(input: {
	c: AppContext;
	requestUserId: string;
	bodyArgs: unknown;
}): Promise<HyperframesRenderToCanvasResult> {
	const args =
		input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
			? (input.bodyArgs as Record<string, unknown>)
			: {};

	const html = readTrimmedString(args.html);
	if (!html) {
		throw new AppError("html is required", {
			status: 400,
			code: "agents_tool_hyperframes_missing_html",
		});
	}

	const assets: HyperframesRenderAsset[] = Array.isArray(args.assets)
		? (args.assets as unknown[])
				.map((item) => {
					if (!item || typeof item !== "object" || Array.isArray(item)) return null;
					const record = item as Record<string, unknown>;
					const name = readTrimmedString(record.name);
					const url = readTrimmedString(record.url);
					return name && url ? { name, url } : null;
				})
				.filter((item): item is HyperframesRenderAsset => item !== null)
		: [];

	const fpsRaw = Number(args.fps);
	const qualityRaw = readTrimmedString(args.quality);
	const quality =
		qualityRaw === "draft" || qualityRaw === "high" || qualityRaw === "standard"
			? (qualityRaw as "draft" | "standard" | "high")
			: undefined;

	try {
		const result = await renderHyperframesComposition(input.c, input.requestUserId, {
			html,
			assets,
			...(Number.isFinite(fpsRaw) && fpsRaw > 0 ? { fps: fpsRaw } : {}),
			...(quality ? { quality } : {}),
		});
		return {
			ok: true,
			videoUrl: result.url,
			key: result.key,
			bytes: result.bytes,
			durationSec: result.durationSec,
		};
	} catch (err) {
		if (err instanceof AppError) throw err;
		throw new AppError("hyperframes 渲染失败", {
			status: 502,
			code: "agents_tool_hyperframes_render_failed",
			details: { message: err instanceof Error ? err.message : String(err) },
		});
	}
}
