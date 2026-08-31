// 像素级抠图引擎。
//
// 与 LLM/Gemini 的「生成式重绘抠图」不同，这里走真正的像素级分割：
//   remove.bg —— 经 new-api `/proxy/remove-bg/v1.0/removebg` 代理转发到三方 remove.bg。
//
// 产出带 alpha 通道的透明 PNG（Uint8Array）。remove.bg 不可用（未配渠道/未配 key/出网失败）
// 时直接报错——本地 ONNX 兜底已下线（产品决策：抠图只走 remove.bg）。
import { AppError } from "../../middleware/error";

export type RemoveBgEngine = "remove_bg";

export interface RemoveBgResult {
	/** 透明 PNG 字节 */
	bytes: Uint8Array;
	/** 实际命中的引擎，便于排障 */
	engine: RemoveBgEngine;
}

export interface RemoveImageBackgroundOptions {
	imageBytes: Uint8Array;
	mimeType?: string | null;
	/** new-api 内网 base（relay.baseUrl），用于 remove.bg 代理 */
	proxyBaseUrl?: string | null;
	/** new-api 内网 token（relay.token） */
	proxyToken?: string | null;
}

const REMOVE_BG_TIMEOUT_MS = 120_000;

export async function removeImageBackground(
	opts: RemoveImageBackgroundOptions,
): Promise<RemoveBgResult> {
	const mimeType = (opts.mimeType || "image/png").trim() || "image/png";

	if (!opts.proxyBaseUrl || !opts.proxyToken) {
		throw new AppError("抠图失败：remove.bg 代理未配置（缺少 new-api relay base/token）", {
			status: 502,
			code: "remove_bg_proxy_unconfigured",
		});
	}

	try {
		const bytes = await removeViaRemoveBgProxy(
			opts.imageBytes,
			mimeType,
			opts.proxyBaseUrl,
			opts.proxyToken,
		);
		if (bytes.length === 0) {
			throw new AppError("抠图失败：remove.bg 返回空结果", {
				status: 502,
				code: "remove_bg_empty_result",
			});
		}
		return { bytes, engine: "remove_bg" };
	} catch (err) {
		if (err instanceof AppError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		throw new AppError(`抠图失败：remove.bg 不可用：${message}`, {
			status: 502,
			code: "remove_bg_failed",
			details: { proxyError: message },
		});
	}
}

async function removeViaRemoveBgProxy(
	imageBytes: Uint8Array,
	mimeType: string,
	baseUrl: string,
	token: string,
): Promise<Uint8Array> {
	const url = `${baseUrl.replace(/\/+$/, "")}/proxy/remove-bg/v1.0/removebg`;
	const form = new FormData();
	// 注意：用 ArrayBuffer 切片避免把整个 Buffer 池带进 Blob。
	const ab = imageBytes.buffer.slice(
		imageBytes.byteOffset,
		imageBytes.byteOffset + imageBytes.byteLength,
	);
	form.append("image_file", new Blob([ab], { type: mimeType }), "image.png");
	form.append("size", "auto");

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REMOVE_BG_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: form,
			signal: controller.signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`remove.bg 代理 HTTP ${res.status} ${text.slice(0, 240)}`);
		}
		return new Uint8Array(await res.arrayBuffer());
	} finally {
		clearTimeout(timer);
	}
}
