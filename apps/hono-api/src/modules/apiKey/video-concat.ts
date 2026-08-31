import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import type { AppContext } from "../../types";
import {
	createObjectStorageClientFromConfig,
	resolveObjectStorageConfig,
	type ObjectStorageConfig,
} from "../asset/rustfs.client";
import { putFileToStorage } from "../asset/asset.hosting.stream-upload";
import { FFMPEG_EXEC_OPTS } from "../task/subprocess-limits";
import { createTaskWorkspace } from "../../platform/node/task-workspace";
import type { S3Client } from "@aws-sdk/client-s3";

import {
	buildColorCorrections,
	buildSinglePassConcatArgs,
	colorFilterOf,
	TARGET_AR,
	TARGET_FPS,
	XFADE_TRANSITIONS,
	type ClipMeta,
	type Dims,
	type YuvStats,
} from "./video-concat.filtergraph";
import {
	resolveVideoConcatPolicy,
	validateVideoConcatTransitions,
	type VideoConcatJoinMode,
} from "./video-concat.policy";
import {
	concatVideosViaMediaWorker,
	muxAudioViaMediaWorker,
} from "../../platform/media-worker/client";

const execFileAsync = promisify(execFile);

/** 探片段平均 YAVG/UAVG/VAVG（采样前 24 帧，signalstats）；失败返回 null。 */
async function probeAvgYUV(file: string): Promise<YuvStats | null> {
	try {
		const { stdout } = await run("ffprobe", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`movie=${file},signalstats`,
			"-show_entries",
			"frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.UAVG,lavfi.signalstats.VAVG",
			"-of",
			"csv=p=0",
			"-read_intervals",
			"%+#24",
		]);
		const rows = stdout
			.trim()
			.split("\n")
			.map((l) => l.split(",").map(Number))
			.filter((r) => r.length >= 3 && r.every((n) => Number.isFinite(n)));
		if (!rows.length) return null;
		const avg = (i: number) => rows.reduce((a, r) => a + r[i], 0) / rows.length;
		return { y: avg(0), u: avg(1), v: avg(2) };
	} catch {
		return null;
	}
}

function makeEven(n: number): number {
	const r = Math.round(n);
	return r % 2 === 0 ? r : r + 1;
}

// Derive uniform output dimensions for the concatenated film.
// - targetAspect "a:b" (e.g. "9:16") pins orientation/aspect while preserving
//   the first clip's short-side resolution. A 480p source must not be silently
//   upscaled to 1080p merely because the caller also supplied "16:9".
// - when the first clip cannot be probed, use a 1080 short-side fallback.
// - no/invalid aspect → fall back to the first clip's actual dimensions, so we
//   preserve the clips' real format instead of force-fitting a hardcoded 16:9.
export function resolveTargetDims(targetAspect: string | undefined, firstClip: Dims | null): Dims {
	const m = (targetAspect || "").trim().match(/^(\d+(?:\.\d+)?)\s*[:：x×/]\s*(\d+(?:\.\d+)?)$/);
	if (m) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		if (a > 0 && b > 0) {
			const shortSide = firstClip && firstClip.w > 0 && firstClip.h > 0
				? Math.min(firstClip.w, firstClip.h)
				: 1080;
			if (a >= b) return { w: makeEven((shortSide * a) / b), h: makeEven(shortSide) };
			return { w: makeEven(shortSide), h: makeEven((shortSide * b) / a) };
		}
	}
	if (firstClip && firstClip.w > 0 && firstClip.h > 0) {
		return { w: makeEven(firstClip.w), h: makeEven(firstClip.h) };
	}
	// last-resort default: vertical 9:16 (e-commerce/short-video first)
	return { w: 1080, h: 1920 };
}

async function probeDims(file: string): Promise<Dims | null> {
	try {
		const { stdout } = await run("ffprobe", [
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"csv=p=0",
			file,
		]);
		const [w, h] = stdout.trim().split(",").map((x) => Number(x));
		if (w > 0 && h > 0) return { w, h };
	} catch {
		// ignore
	}
	return null;
}

export type ConcatVideosResult = {
	url: string;
	key: string;
	clipCount: number;
	bytes: number;
	joinMode: VideoConcatJoinMode;
	xfadeSeconds: number;
	colorMatch: boolean;
};

async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return execFileAsync(cmd, args, FFMPEG_EXEC_OPTS);
}

// 片段下载并发上限：单条 TCP 流通常吃不满出口带宽，并行明显缩短总下载耗时；
// 上限设小避免打爆句柄/触发 CDN 限流。
const DOWNLOAD_CONCURRENCY = 4;

/** 有界并发 map：结果顺序与 items 一致；任一项失败即整体 reject。 */
async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from(
		{ length: Math.max(1, Math.min(limit, items.length)) },
		async () => {
			while (next < items.length) {
				const i = next;
				next += 1;
				results[i] = await fn(items[i], i);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

// Download a clip. If the URL points at our own object storage, pull it via the
// S3 API (GetObject) instead of the public CDN — in some egress-restricted
// environments the CDN domain is throttled while the S3 endpoint is reachable.
export async function downloadTo(
	url: string,
	dest: string,
	storage: ObjectStorageConfig,
	s3: S3Client,
): Promise<void> {
	const publicBase = storage.publicBase.trim().replace(/\/+$/, "");
	if (publicBase && url.startsWith(`${publicBase}/`)) {
		const key = url.slice(publicBase.length + 1).split(/[?#]/)[0];
		const out = await s3.send(
			new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
		);
		// Stream directly to disk — avoids loading the entire clip into a Buffer.
		await streamPipeline((out.Body as any).transformToWebStream(), createWriteStream(dest));
		return;
	}
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`download failed (${res.status}) for ${url}`);
	}
	// Stream directly to disk — avoids loading the entire clip into a Buffer.
	const { Readable } = await import("node:stream");
	await streamPipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
}

async function hasAudioStream(file: string): Promise<boolean> {
	try {
		const { stdout } = await run("ffprobe", [
			"-v",
			"error",
			"-select_streams",
			"a",
			"-show_entries",
			"stream=index",
			"-of",
			"csv=p=0",
			file,
		]);
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}

// Re-encode each clip to identical codec/resolution/fps/audio so they can be
// concatenated losslessly with the concat demuxer (hard-cut fallback path only;
// the default xfade path folds all of this into one single-pass filter graph).
// colorFilter（含前导逗号，可为空串）把跨镜色彩匹配折进同一遍编码，省掉旧的
// 独立 color-match 重编码 pass。
async function normalizeClip(
	src: string,
	dst: string,
	dims: Dims,
	hasAudio: boolean,
	colorFilter: string,
	trim?: { inSec: number; outSec: number | null } | null,
): Promise<void> {
	// scale to fill the target box then center-crop — keeps clips that already
	// match the target aspect pixel-identical and crops (not letterboxes)
	// near-aspect clips, so we never bake horizontal bars onto a vertical film.
	const vf = `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase,crop=${dims.w}:${dims.h},setsar=1,fps=${TARGET_FPS}${colorFilter}`;
	const args: string[] = ["-y"];
	// 逐段内切：-ss 放在 -i 前（转码路径下 ffmpeg 会解码丢帧到目标点，精确且快），
	// 时长用 -t 钉住（-ss 前置后时间戳已重置，不能用 -to）。
	if (trim && trim.inSec > 0) args.push("-ss", trim.inSec.toFixed(3));
	if (hasAudio) {
		args.push("-i", src);
	} else {
		// synthesize silent stereo audio matched to the video length
		args.push(
			"-i",
			src,
			"-f",
			"lavfi",
			"-i",
			`anullsrc=channel_layout=stereo:sample_rate=${TARGET_AR}`,
		);
	}
	if (trim && trim.outSec !== null && trim.outSec > trim.inSec) {
		args.push("-t", (trim.outSec - trim.inSec).toFixed(3));
	}
	args.push(
		"-vf",
		vf,
		"-c:v",
		"libx264",
		"-preset",
		"medium",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-ar",
		String(TARGET_AR),
		"-ac",
		"2",
	);
	if (hasAudio) {
		args.push("-map", "0:v:0", "-map", "0:a:0");
	} else {
		args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest");
	}
	args.push(dst);
	await run("ffmpeg", args);
}

export type MuxAudioResult = {
	url: string;
	key: string;
	bytes: number;
	durationSec: number | null;
};

export async function probeDurationSecond(file: string): Promise<number | null> {
	try {
		const { stdout } = await run("ffprobe", [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			file,
		]);
		const duration = Number(stdout.trim());
		return Number.isFinite(duration) && duration > 0
			? Math.round(duration * 100) / 100
			: null;
	} catch {
		return null;
	}
}

/**
 * Mux an external audio track (voiceover / BGM) onto a video.
 *
 * - mode "replace": drop the video's original audio and use the new track.
 * - mode "mix": keep the original audio (attenuated by originalVolume) and
 *   overlay the new track on top. Falls back to replace when the video has
 *   no audio stream.
 *
 * The video stream is always copied (no re-encode); output duration is pinned
 * to the video — a shorter audio track is padded with silence, a longer one
 * is truncated.
 */
export async function muxAudioOntoVideo(
	c: AppContext,
	userId: string,
	input: {
		videoUrl: string;
		audioUrl: string;
		mode?: "mix" | "replace";
		/** 0~1，mix 模式下原音轨保留音量，默认 0.3 */
		originalVolume?: number;
		/** 0~2，新音轨音量，默认 1 */
		audioVolume?: number;
	},
): Promise<MuxAudioResult> {
	const videoUrl = (input.videoUrl || "").trim();
	const audioUrl = (input.audioUrl || "").trim();
	if (!videoUrl || !audioUrl) {
		throw new Error("videoUrl and audioUrl are required");
	}

	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) throw new Error("Object storage is not configured");
	const client = createObjectStorageClientFromConfig(storageConfig);

	const clampVolume = (value: unknown, fallback: number, max: number): number => {
		const n = typeof value === "number" ? value : Number.NaN;
		if (!Number.isFinite(n)) return fallback;
		return Math.min(max, Math.max(0, n));
	};
	const originalVolume = clampVolume(input.originalVolume, 0.3, 1);
	const audioVolume = clampVolume(input.audioVolume, 1, 2);

	// 优先走 media-worker(Go)；失败回退本地 ffmpeg（下方原实现）。
	const viaWorker = await muxAudioViaMediaWorker({
		videoUrl,
		audioUrl,
		mode: input.mode,
		originalVolume,
		audioVolume,
		userId,
	});
	if (viaWorker) {
		return {
			url: viaWorker.url,
			key: viaWorker.key,
			bytes: viaWorker.bytes,
			durationSec: viaWorker.durationSec,
		};
	}

	const workspace = await createTaskWorkspace("video-mux");
	const workDir = workspace.path;
	try {
		const videoFile = join(workDir, "video.mp4");
		const audioFile = join(workDir, "audio.mp3");
		await downloadTo(videoUrl, videoFile, storageConfig, client);
		await downloadTo(audioUrl, audioFile, storageConfig, client);

		const videoHasAudio = await hasAudioStream(videoFile);
		const mode = input.mode === "mix" && videoHasAudio ? "mix" : "replace";

		const outFile = join(workDir, "muxed.mp4");
		const args: string[] = ["-y", "-i", videoFile, "-i", audioFile];
		if (mode === "mix") {
			args.push(
				"-filter_complex",
				`[0:a]volume=${originalVolume}[orig];[1:a]volume=${audioVolume},apad[voice];[orig][voice]amix=inputs=2:duration=first:normalize=0[aout]`,
				"-map",
				"0:v:0",
				"-map",
				"[aout]",
			);
		} else {
			args.push(
				"-filter_complex",
				`[1:a]volume=${audioVolume},apad[aout]`,
				"-map",
				"0:v:0",
				"-map",
				"[aout]",
				"-shortest",
			);
		}
		args.push(
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-ar",
			String(TARGET_AR),
			"-ac",
			"2",
			"-movflags",
			"+faststart",
			outFile,
		);
		await run("ffmpeg", args);

		const sizeBytes = (await stat(outFile)).size;
		const durationSec = await probeDurationSecond(outFile);
		const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
		const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
		const key = `gen/videos/${safeUser}/${datePrefix}/${randomUUID()}.mp4`;
		// Stream the on-disk output to storage — never readFile the whole mp4 into heap.
		await putFileToStorage({
			client,
			bucket: storageConfig.bucket,
			key,
			filePath: outFile,
			contentType: "video/mp4",
		});

		const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");
		const url = publicBase ? `${publicBase}/${key}` : `/${key}`;
		return { url, key, bytes: sizeBytes, durationSec };
	} finally {
		await workspace.cleanup().catch((error: unknown) => {
			console.error("[video-mux] temporary workspace cleanup failed", {
				workDir,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}
}

/**
 * 单个拼接段：url 必填；inSec/outSec 可选 = 只取源素材该区间（逐段内切）。
 * 同一 url 可出现多次、各取不同区间（亚秒冲击簇/打击帧插帧的基建）。
 */
export type ConcatClipSpec = {
	url: string;
	inSec?: number;
	outSec?: number;
	/**
	 * 进入本段的 xfade 转场类型（第 0 段忽略——两段之间的转场记在后一段上）。
	 * 只有显式 xfade 策略可填写；第 1 段之后逐缝必填并命中白名单。
	 * hard_cut 禁止填写，不存在默认 fade 或静默替换。
	 */
	transition?: string;
};

export function normalizeClipSpecs(clips: Array<string | ConcatClipSpec>): ConcatClipSpec[] {
	return clips.map((entry, i) => {
		const spec = typeof entry === "string" ? { url: entry } : entry;
		const url = (spec?.url || "").trim();
		if (!url) throw new Error(`clips[${i}]: url is required`);
		const inSec = spec.inSec;
		const outSec = spec.outSec;
		if (inSec !== undefined && (!Number.isFinite(inSec) || inSec < 0)) {
			throw new Error(`clips[${i}]: inSec must be a non-negative number`);
		}
		if (outSec !== undefined && (!Number.isFinite(outSec) || outSec <= 0)) {
			throw new Error(`clips[${i}]: outSec must be a positive number`);
		}
		if (inSec !== undefined && outSec !== undefined && outSec - inSec < 0.1) {
			throw new Error(`clips[${i}]: outSec must exceed inSec by at least 0.1s`);
		}
		// 非空转场在入口先验白名单；是否逐缝必填、是否与 hard_cut 冲突由
		// validateVideoConcatTransitions 依据显式策略统一校验。
		const transition = spec.transition?.trim();
		if (transition !== undefined && transition !== "" && !XFADE_TRANSITIONS.has(transition)) {
			throw new Error(
				`clips[${i}]: unknown transition ${JSON.stringify(transition)}; ` +
					`must be one of ffmpeg xfade transitions (e.g. fade, slideup, circleopen, radial, dissolve)`,
			);
		}
		return { url, inSec, outSec, transition };
	});
}

/**
 * Download a list of clip URLs, normalize them to a uniform format, concatenate
 * them into a single mp4, upload the result to object storage, and return its
 * public URL. Requires ffmpeg/ffprobe to be available on PATH (baked into the
 * api image).
 *
 * Each entry is either a plain URL (whole clip) or { url, inSec?, outSec? } to
 * use only that source range — the same URL may repeat with different ranges,
 * which is how sub-second burst cutting / impact-frame inserts are assembled
 * from longer generated footage.
 *
 * targetAspect ("9:16"/"16:9"/"1:1"…) pins the output dimensions/orientation so
 * a vertical film never gets letterboxed into landscape. When omitted, the first
 * clip's real dimensions are used (never a hardcoded 16:9).
 */
export async function concatVideosFromUrls(
	c: AppContext,
	userId: string,
	clipUrls: Array<string | ConcatClipSpec>,
	fileName?: string,
	targetAspect?: string,
	options?: {
		allowLocalMediaProcessing?: boolean;
		xfadeSeconds?: number;
		colorMatch?: boolean;
	},
): Promise<ConcatVideosResult> {
	if (!Array.isArray(clipUrls) || clipUrls.length < 2) {
		throw new Error("clipUrls must contain at least 2 video URLs");
	}
	const specs = normalizeClipSpecs(clipUrls);
	const environment = c.env as Record<string, unknown>;
	const policy = resolveVideoConcatPolicy({
		environmentXfadeSeconds:
			environment.VIDEO_CONCAT_XFADE_SECONDS ??
			globalThis.process?.env?.VIDEO_CONCAT_XFADE_SECONDS,
		environmentColorMatch:
			environment.VIDEO_CONCAT_COLOR_MATCH ??
			globalThis.process?.env?.VIDEO_CONCAT_COLOR_MATCH,
		requestedXfadeSeconds: options?.xfadeSeconds,
		requestedColorMatch: options?.colorMatch,
	});
	validateVideoConcatTransitions({
		clips: specs,
		policy,
		isSupportedTransition: (transition) => XFADE_TRANSITIONS.has(transition),
	});

	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) {
		throw new Error("Object storage is not configured");
	}

	// 优先走 media-worker(Go)：下载/探测/重编码全在 worker 容器，api 堆零媒体字节。
	// 拼接策略先由纯结构 policy 冻结；默认 hard_cut + 不自动平均调色。
	const viaWorker = await concatVideosViaMediaWorker({
		clips: specs,
		userId,
		targetAspect,
		xfadeSeconds: policy.xfadeSeconds,
		colorMatch: policy.colorMatch,
	});
	if (viaWorker) {
		return {
			url: viaWorker.url,
			key: viaWorker.key,
			clipCount: viaWorker.clipCount,
			bytes: viaWorker.bytes,
			joinMode: policy.joinMode,
			xfadeSeconds: policy.xfadeSeconds,
			colorMatch: policy.colorMatch,
		};
	}
	if (options?.allowLocalMediaProcessing !== true) {
		throw new Error("media_worker_video_concat_unavailable");
	}

	const client = createObjectStorageClientFromConfig(storageConfig);
	const workspace = await createTaskWorkspace("video-concat");
	const workDir = workspace.path;
	try {
		// 1. 并行下载全部片段（有界并发，避免打爆出口带宽/句柄）。
		//    按 URL 去重：同一源素材多区间复用时只下载/探测一次。
		const uniqueUrls = [...new Set(specs.map((s) => s.url))];
		const fileByUrl = new Map<string, string>(
			uniqueUrls.map((url, i) => [url, join(workDir, `raw-${i}.mp4`)]),
		);
		await mapWithConcurrency(uniqueUrls, DOWNLOAD_CONCURRENCY, (url) =>
			downloadTo(url, fileByUrl.get(url) as string, storageConfig, client),
		);
		const rawFiles = specs.map((s) => fileByUrl.get(s.url) as string);

		// 2. 并行探测（按去重后的源文件）：首段尺寸 + 每源音轨/时长/平均YUV。
		const colorMatch = policy.colorMatch;
		type SourceMeta = { hasAudio: boolean; durationSec: number | null; yuv: YuvStats | null };
		const [firstDims, sourceMetaList] = await Promise.all([
			probeDims(rawFiles[0]),
			Promise.all(
				uniqueUrls.map(async (url): Promise<SourceMeta> => {
					const f = fileByUrl.get(url) as string;
					const [hasAudio, durationSec, yuv] = await Promise.all([
						hasAudioStream(f),
						probeDurationSecond(f),
						colorMatch ? probeAvgYUV(f) : Promise.resolve(null),
					]);
					return { hasAudio, durationSec, yuv };
				}),
			),
		]);
		const sourceMetaByUrl = new Map<string, SourceMeta>(
			uniqueUrls.map((url, i) => [url, sourceMetaList[i]]),
		);
		if (colorMatch) {
			const missingColorFacts = uniqueUrls.filter((url) => !sourceMetaByUrl.get(url)?.yuv);
			if (missingColorFacts.length > 0) {
				throw new Error(`video_concat_color_match_probe_failed:${missingColorFacts.length}`);
			}
		}

		// 3. 每个拼接段的有效元数据：trim 区间夹到源时长内，durationSec = 有效时长。
		const clipMetas: ClipMeta[] = specs.map((s, i) => {
			const src = sourceMetaByUrl.get(s.url) as SourceMeta;
			const wantsTrim = s.inSec !== undefined || s.outSec !== undefined;
			if (!wantsTrim) return { ...src, trim: null, transition: s.transition ?? null };
			const inSec = Math.max(0, s.inSec ?? 0);
			const outSec =
				s.outSec !== undefined
					? src.durationSec !== null
						? Math.min(s.outSec, src.durationSec)
						: s.outSec
					: src.durationSec;
			if (outSec !== null && outSec - inSec < 0.1) {
				throw new Error(
					`clips[${i}]: trim range [${inSec}, ${outSec}) is empty (source is ${src.durationSec ?? "unknown"}s)`,
				);
			}
			return {
				hasAudio: src.hasAudio,
				yuv: src.yuv,
				durationSec: outSec !== null ? outSec - inSec : null,
				trim: outSec !== null ? { inSec, outSec } : null,
				transition: s.transition ?? null,
			};
		});
		const dims = resolveTargetDims(targetAspect, firstDims);
		const outFile = join(workDir, "final.mp4");
		const xfadeSeconds = policy.xfadeSeconds;

		// 3. 默认单 pass：normalize(缩放/裁剪/统一帧率) + 跨镜色彩匹配 + xfade 叠化
		//    全部折进一个 filter_complex，整片只解码/编码一遍。
		//    (旧管线是 normalize、color-match、xfade 三遍串行重编码。)
		const singlePassArgs = buildSinglePassConcatArgs({
			clips: clipMetas,
			files: rawFiles,
			dims,
			xfadeSeconds,
			colorMatch,
			outFile,
		});
		if (singlePassArgs) {
			await run("ffmpeg", singlePassArgs);
		} else {
			if (policy.joinMode === "xfade") {
				throw new Error("video_concat_explicit_xfade_unexecutable");
			}
			// 明确的硬切策略：逐段 normalize（可选色彩校正折进同一遍编码）后用
			// concat demuxer 流拷贝。它不重叠画面/音频，也不缩短段落时间轴。
			const corrections = colorMatch
				? buildColorCorrections(clipMetas.map((m) => m.yuv))
				: null;
			const normalized: string[] = [];
			for (let i = 0; i < rawFiles.length; i += 1) {
				const norm = join(workDir, `norm-${i}.mp4`);
				// trim 透传：有完整区间用之；只有 inSec（源时长未知）也照切，outSec 留空=到结尾。
				const meta = clipMetas[i];
				const spec = specs[i];
				const fallbackTrim = meta.trim
					? { inSec: meta.trim.inSec, outSec: meta.trim.outSec as number | null }
					: spec.inSec !== undefined || spec.outSec !== undefined
						? { inSec: Math.max(0, spec.inSec ?? 0), outSec: spec.outSec ?? null }
						: null;
				await normalizeClip(
					rawFiles[i],
					norm,
					dims,
					meta.hasAudio,
					colorFilterOf(corrections ? corrections[i] : null),
					fallbackTrim,
				);
				normalized.push(norm);
			}
			const listFile = join(workDir, "list.txt");
			await writeFile(
				listFile,
				normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
				"utf-8",
			);
			await run("ffmpeg", [
				"-y",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				listFile,
				"-c",
				"copy",
				"-movflags",
				"+faststart",
				outFile,
			]);
		}

		// 3. upload to object storage — stream the assembled film straight from disk,
		// never readFile the whole (often 100s-of-MB) output into the JS heap.
		const sizeBytes = (await stat(outFile)).size;
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

		return {
			url,
			key,
			clipCount: clipUrls.length,
			bytes: sizeBytes,
			joinMode: policy.joinMode,
			xfadeSeconds: policy.xfadeSeconds,
			colorMatch: policy.colorMatch,
		};
	} finally {
		await workspace.cleanup().catch((error: unknown) => {
			console.error("[video-concat] temporary workspace cleanup failed", {
				workDir,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}
}
