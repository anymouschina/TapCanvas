import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AppContext } from "../../types";
import {
	createObjectStorageClientFromConfig,
	resolveObjectStorageConfig,
} from "../asset/rustfs.client";
import { downloadTo, probeDurationSecond } from "./video-concat";
import { putFileToStorage } from "../asset/asset.hosting.stream-upload";
import { createTaskWorkspace } from "../../platform/node/task-workspace";

const execFileAsync = promisify(execFile);

// 包装层短片段渲染，不是整片合成器——限额据此设定。
const MAX_HTML_CHARS = 512 * 1024;
const MAX_ASSETS = 24;
const MAX_TOTAL_ASSET_BYTES = 200 * 1024 * 1024;
const DEFAULT_RENDER_TIMEOUT_MS = 10 * 60 * 1000;

export type HyperframesRenderAsset = { name: string; url: string };

export type HyperframesRenderResult = {
	url: string;
	key: string;
	bytes: number;
	durationSec: number | null;
};

function resolveCliEntry(): string {
	return (
		(process.env.HYPERFRAMES_CLI_ENTRY || "").trim() ||
		"/opt/hyperframes/node_modules/hyperframes/dist/cli.js"
	);
}

function resolveRenderTimeoutMs(): number {
	const n = Number(process.env.HYPERFRAMES_RENDER_TIMEOUT_MS ?? "");
	return Number.isFinite(n) && n >= 30_000 ? n : DEFAULT_RENDER_TIMEOUT_MS;
}

// Asset 文件名收紧到单层相对路径，杜绝 ../ 逃逸出临时项目目录。
function sanitizeAssetName(name: string): string {
	const trimmed = String(name || "").trim();
	if (!trimmed || trimmed.length > 128) return "";
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) return "";
	if (trimmed.includes("..")) return "";
	return trimmed;
}

/**
 * Render a single-file HyperFrames composition (authored by the 剪辑师 agent) to
 * an mp4 and upload it to object storage. Designed for the "packaging layer" of
 * the video pipeline — title cards, animated captions, intros/outros — NOT for
 * full-film assembly (that stays on ffmpeg concat).
 *
 * Remote assets are pre-downloaded into `<project>/assets/<name>` (S3-aware for
 * our own storage domain) so headless Chromium never fetches through the
 * egress-restricted容器网络; the composition must reference them as
 * `./assets/<name>`.
 */
export async function renderHyperframesComposition(
	c: AppContext,
	userId: string,
	input: {
		html: string;
		assets?: HyperframesRenderAsset[];
		fps?: number;
		quality?: "draft" | "standard" | "high";
		fileName?: string;
	},
): Promise<HyperframesRenderResult> {
	const html = String(input.html || "");
	if (!html.trim()) {
		throw new Error("html is required");
	}
	if (html.length > MAX_HTML_CHARS) {
		throw new Error(`html too large (${html.length} chars > ${MAX_HTML_CHARS})`);
	}
	if (!/data-composition-id\s*=/.test(html)) {
		throw new Error(
			"composition html must contain a root element with data-composition-id",
		);
	}

	const cliEntry = resolveCliEntry();
	try {
		await access(cliEntry);
	} catch {
		throw new Error(
			`hyperframes renderer is not installed in this image (missing ${cliEntry}); rebuild the api image`,
		);
	}

	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) {
		throw new Error("Object storage is not configured");
	}
	const client = createObjectStorageClientFromConfig(storageConfig);

	const assets = Array.isArray(input.assets) ? input.assets : [];
	if (assets.length > MAX_ASSETS) {
		throw new Error(`too many assets (${assets.length} > ${MAX_ASSETS})`);
	}

	const workspace = await createTaskWorkspace("hyperframes-render");
	const workDir = workspace.path;
	try {
		await writeFile(join(workDir, "index.html"), html, "utf-8");
		await writeFile(
			join(workDir, "hyperframes.json"),
			JSON.stringify({ paths: { assets: "assets" } }),
			"utf-8",
		);

		if (assets.length > 0) {
			const assetsDir = join(workDir, "assets");
			await mkdir(assetsDir, { recursive: true });
			let totalBytes = 0;
			const seen = new Set<string>();
			for (const asset of assets) {
				const name = sanitizeAssetName(asset?.name ?? "");
				const url = String(asset?.url || "").trim();
				if (!name) {
					throw new Error(`invalid asset name: ${String(asset?.name ?? "")}`);
				}
				if (seen.has(name)) {
					throw new Error(`duplicate asset name: ${name}`);
				}
				seen.add(name);
				if (!/^https?:\/\//i.test(url)) {
					throw new Error(`asset ${name} must use an http(s) url`);
				}
				const dest = join(assetsDir, name);
				await downloadTo(url, dest, storageConfig, client);
			const downloaded = await stat(dest);
			totalBytes += downloaded.size;
				if (totalBytes > MAX_TOTAL_ASSET_BYTES) {
					throw new Error(
						`assets exceed total size budget (${MAX_TOTAL_ASSET_BYTES} bytes)`,
					);
				}
			}
		}

		const outFile = join(workDir, "out.mp4");
		const fps = Number.isFinite(input.fps) && Number(input.fps) > 0
			? Math.min(60, Math.max(12, Math.round(Number(input.fps))))
			: 30;
		const quality =
			input.quality === "draft" || input.quality === "high"
				? input.quality
				: "standard";
		try {
			await execFileAsync(
				process.execPath,
				[
					cliEntry,
					"render",
					workDir,
					"-o",
					outFile,
					"-f",
					String(fps),
					"-q",
					quality,
					"--quiet",
				],
				{
					timeout: resolveRenderTimeoutMs(),
					maxBuffer: 1024 * 1024 * 16,
					env: {
						...process.env,
						// 渲染期禁连 heygen 云端（publish/registry）；纯本地渲染。
						HYPERFRAMES_DISABLE_TELEMETRY: "1",
					},
				},
			);
		} catch (err) {
			const detail =
				err && typeof err === "object" && "stderr" in err
					? String((err as { stderr?: unknown }).stderr ?? "").slice(-2000)
					: "";
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(
				`hyperframes render failed: ${message}${detail ? `\n${detail}` : ""}`,
			);
		}

		const output = await stat(outFile);
		if (output.size === 0) {
			throw new Error("hyperframes render produced an empty file");
		}
		const durationSec = await probeDurationSecond(outFile);
		const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
		const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
		const key = `gen/videos/${safeUser}/${datePrefix}/${randomUUID()}.mp4`;
		await putFileToStorage({
			client,
			bucket: storageConfig.bucket,
			key,
			filePath: outFile,
			contentType: "video/mp4",
		});

		const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");
		const url = publicBase ? `${publicBase}/${key}` : `/${key}`;
		return { url, key, bytes: output.size, durationSec };
	} finally {
		await workspace.cleanup().catch((error: unknown) => {
			console.error("[hyperframes-render] temporary workspace cleanup failed", {
				workDir,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}
}
