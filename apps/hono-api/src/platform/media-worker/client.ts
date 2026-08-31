// media-worker(Go) gRPC 客户端。
//
// 契约真相源：packages/proto/tapmedia/v1/media.proto（@grpc/proto-loader 运行时加载，零 codegen）。
// 铁律：RPC 只传对象 key/参数（控制面），媒体字节走 TOS 数据面。
//
// 灰度语义：MEDIA_WORKER_GRPC_ADDR 未设 → 整链禁用（调用方走原本地 ffmpeg 路径）；
// RPC 失败 → 返回 null，调用方自行回退本地。正确默认 > 硬闸。
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type GrpcUnaryCall<Res> = (
	req: unknown,
	options: { deadline: Date },
	cb: (err: Error | null, res?: Res) => void,
) => void;

type MediaWorkerGrpcClient = {
	waitForReady?: unknown;
	extractPoster: GrpcUnaryCall<{ posterKey?: string; posterUrl?: string }>;
	probeMedia: GrpcUnaryCall<ProbeMediaResult>;
	concatVideos: GrpcUnaryCall<ConcatVideosWorkerResult>;
	muxAudio: GrpcUnaryCall<MuxAudioWorkerResult>;
	extractLastFrame: GrpcUnaryCall<{ frameKey?: string; frameUrl?: string }>;
	extractFramesAt: GrpcUnaryCall<{ frames?: WorkerFrameAt[] }>;
	splitVideo: GrpcUnaryCall<{ segments?: WorkerSplitSegment[] }>;
	transcodeProxy: GrpcUnaryCall<{
		key?: string;
		url?: string;
		sizeBytes?: number | string;
	}>;
};

export type ConcatVideosWorkerResult = {
	key?: string;
	url?: string;
	bytes?: number | string;
	clipCount?: number;
};

export type MuxAudioWorkerResult = {
	key?: string;
	url?: string;
	bytes?: number | string;
	durationSeconds?: number;
};

export type WorkerFrameAt = {
	timeSec?: number;
	key?: string;
	url?: string;
	width?: number;
	height?: number;
};

export type WorkerSplitSegment = {
	index?: number;
	startSec?: number;
	endSec?: number;
	key?: string;
	url?: string;
};

export type ProbeMediaResult = {
	durationSeconds?: number;
	width?: number;
	height?: number;
	videoCodec?: string;
	audioCodec?: string;
	fps?: number;
	sizeBytes?: number | string;
};

export type ExtractPosterResult = {
	posterKey: string;
	posterUrl: string;
};

const PROTO_RELATIVE = "tapmedia/v1/media.proto";

let cachedClient: MediaWorkerGrpcClient | null | undefined;

export function resolveMediaWorkerAddr(): string | null {
	const addr = (process.env.MEDIA_WORKER_GRPC_ADDR || "").trim();
	return addr || null;
}

export function isMediaWorkerEnabled(): boolean {
	return resolveMediaWorkerAddr() !== null;
}

function resolveProtoDir(): string | null {
	const candidates = [
		(process.env.MEDIA_PROTO_DIR || "").trim() || null,
		// 容器：compose 把仓库 packages 挂到 /packages:ro
		"/packages/proto",
		// 本地开发：从 apps/hono-api 相对仓库根
		resolve(process.cwd(), "../../packages/proto"),
		resolve(process.cwd(), "packages/proto"),
	].filter((p): p is string => !!p);
	for (const dir of candidates) {
		if (existsSync(resolve(dir, PROTO_RELATIVE))) return dir;
	}
	return null;
}

function getClient(): MediaWorkerGrpcClient | null {
	if (cachedClient !== undefined) return cachedClient;
	const addr = resolveMediaWorkerAddr();
	if (!addr) {
		cachedClient = null;
		return cachedClient;
	}
	try {
		// 惰性 require：未启用 media-worker 的部署不加载 grpc 原生栈。
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const grpc = require("@grpc/grpc-js");
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const protoLoader = require("@grpc/proto-loader");
		const protoDir = resolveProtoDir();
		if (!protoDir) {
			console.warn(
				"[media-worker] proto dir not found (set MEDIA_PROTO_DIR); media worker disabled",
			);
			cachedClient = null;
			return cachedClient;
		}
		const definition = protoLoader.loadSync(
			resolve(protoDir, PROTO_RELATIVE),
			{
				keepCase: false,
				longs: Number,
				enums: String,
				defaults: true,
				oneofs: true,
				includeDirs: [protoDir],
			},
		);
		const pkg = grpc.loadPackageDefinition(definition) as {
			tapmedia: { v1: { MediaService: new (
				addr: string,
				creds: unknown,
			) => MediaWorkerGrpcClient } };
		};
		cachedClient = new pkg.tapmedia.v1.MediaService(
			addr,
			grpc.credentials.createInsecure(),
		);
	} catch (err) {
		console.warn(
			"[media-worker] grpc client init failed; media worker disabled",
			err instanceof Error ? err.message : String(err),
		);
		cachedClient = null;
	}
	return cachedClient;
}

/** 测试钩子：重置单例（env 变化后重建客户端）。 */
export function __resetMediaWorkerClientForTests(): void {
	cachedClient = undefined;
}

/**
 * 让 media-worker 按对象 key 抽 poster。失败/未启用返回 null（调用方回退本地 ffmpeg）。
 */
export async function extractPosterViaMediaWorker(input: {
	videoR2Key: string;
	userId: string;
	maxEdge?: number;
	timeoutMs?: number;
}): Promise<ExtractPosterResult | null> {
	const client = getClient();
	if (!client) return null;
	const deadline = new Date(Date.now() + (input.timeoutMs ?? 60_000));
	return new Promise((resolvePromise) => {
		try {
			client.extractPoster(
				{
					video: { r2Key: input.videoR2Key },
					userId: input.userId,
					maxEdge: input.maxEdge ?? 0,
				},
				{ deadline },
				(err, res) => {
					if (err || !res?.posterKey || !res?.posterUrl) {
						if (err) {
							console.warn(
								"[media-worker] extractPoster rpc failed (falling back to local)",
								err.message,
							);
						}
						resolvePromise(null);
						return;
					}
					resolvePromise({ posterKey: res.posterKey, posterUrl: res.posterUrl });
				},
			);
		} catch (err) {
			console.warn(
				"[media-worker] extractPoster rpc threw (falling back to local)",
				err instanceof Error ? err.message : String(err),
			);
			resolvePromise(null);
		}
	});
}

/**
 * 通用 unary 调用：失败/未启用一律返回 null（调用方回退本地路径），
 * 错误只 warn 不抛——media-worker 永远是加速路径而非硬依赖。
 */
function callWorker<Res>(
	method: keyof MediaWorkerGrpcClient,
	req: unknown,
	timeoutMs: number,
	label: string,
): Promise<Res | null> {
	const client = getClient();
	if (!client) return Promise.resolve(null);
	const fn = client[method] as GrpcUnaryCall<Res> | undefined;
	if (typeof fn !== "function") return Promise.resolve(null);
	const deadline = new Date(Date.now() + timeoutMs);
	return new Promise((resolvePromise) => {
		try {
			fn.call(client, req, { deadline }, (err, res) => {
				if (err || !res) {
					if (err) {
						console.warn(
							`[media-worker] ${label} rpc failed (falling back to local)`,
							err.message,
						);
					}
					resolvePromise(null);
					return;
				}
				resolvePromise(res);
			});
		} catch (err) {
			console.warn(
				`[media-worker] ${label} rpc threw (falling back to local)`,
				err instanceof Error ? err.message : String(err),
			);
			resolvePromise(null);
		}
	});
}

/**
 * 必须成功的 unary 调用。仅供把 media-worker 作为正式执行路径的能力使用：
 * 未配置、初始化失败、RPC 错误或空响应都会原地抛错，不允许调用方隐式改走本地 ffmpeg。
 */
function callWorkerStrict<Res>(
	method: keyof MediaWorkerGrpcClient,
	req: unknown,
	timeoutMs: number,
	label: string,
): Promise<Res> {
	if (!resolveMediaWorkerAddr()) {
		return Promise.reject(new Error(`MEDIA_WORKER_GRPC_ADDR 未配置，无法执行 ${label}`));
	}
	const client = getClient();
	if (!client) {
		return Promise.reject(new Error(`media-worker 客户端初始化失败，无法执行 ${label}`));
	}
	const fn = client[method] as GrpcUnaryCall<Res> | undefined;
	if (typeof fn !== "function") {
		return Promise.reject(new Error(`media-worker 未实现 ${label} RPC`));
	}
	const deadline = new Date(Date.now() + timeoutMs);
	return new Promise((resolvePromise, rejectPromise) => {
		try {
			fn.call(client, req, { deadline }, (error, response) => {
				if (error) {
					rejectPromise(new Error(`media-worker ${label} RPC 失败：${error.message}`));
					return;
				}
				if (!response) {
					rejectPromise(new Error(`media-worker ${label} RPC 返回空响应`));
					return;
				}
				resolvePromise(response);
			});
		} catch (error: unknown) {
			rejectPromise(new Error(
				`media-worker ${label} RPC 调用异常：${error instanceof Error ? error.message : String(error)}`,
			));
		}
	});
}

/**
 * 多段拼接（media-worker 路径）。clips 语义对齐 ConcatClipSpec；
 * xfadeSeconds/colorMatch 由调用方按 api env 解析后传入（env 真相源留在 api）。
 */
export async function concatVideosViaMediaWorker(input: {
	clips: Array<{ url: string; inSec?: number; outSec?: number; transition?: string }>;
	userId: string;
	targetAspect?: string;
	xfadeSeconds: number;
	colorMatch: boolean;
	timeoutMs?: number;
}): Promise<{ key: string; url: string; bytes: number; clipCount: number } | null> {
	// Concat is a paid-workflow finishing boundary, not an optional acceleration.
	// Preserve the exact RPC failure so the execution lifecycle can checkpoint it
	// and rerun this boundary without regenerating already accepted media assets.
	const res = await callWorkerStrict<ConcatVideosWorkerResult>(
		"concatVideos",
		{
			clips: input.clips.map((c) => ({
				url: c.url,
				...(c.inSec !== undefined ? { inSec: c.inSec } : {}),
				...(c.outSec !== undefined ? { outSec: c.outSec } : {}),
				...(c.transition ? { transition: c.transition } : {}),
			})),
			userId: input.userId,
			targetAspect: input.targetAspect ?? "",
			xfadeSeconds: input.xfadeSeconds,
			colorMatch: input.colorMatch,
		},
		// 长任务：下载+单pass重编码可达分钟级；给到 ffmpeg 硬超时(15min)+下载余量。
		input.timeoutMs ?? 30 * 60_000,
		"concatVideos",
	);
	if (!res?.key || !res?.url) return null;
	return {
		key: res.key,
		url: res.url,
		bytes: Number(res.bytes ?? 0),
		clipCount: Number(res.clipCount ?? input.clips.length),
	};
}

/** 外部音轨混流（media-worker 路径）。 */
export async function muxAudioViaMediaWorker(input: {
	videoUrl: string;
	audioUrl: string;
	mode?: "mix" | "replace";
	originalVolume?: number;
	audioVolume?: number;
	userId: string;
	timeoutMs?: number;
}): Promise<{ key: string; url: string; bytes: number; durationSec: number | null } | null> {
	const res = await callWorker<MuxAudioWorkerResult>(
		"muxAudio",
		{
			videoUrl: input.videoUrl,
			audioUrl: input.audioUrl,
			mode: input.mode ?? "",
			...(input.originalVolume !== undefined
				? { originalVolume: input.originalVolume }
				: {}),
			...(input.audioVolume !== undefined ? { audioVolume: input.audioVolume } : {}),
			userId: input.userId,
		},
		input.timeoutMs ?? 10 * 60_000,
		"muxAudio",
	);
	if (!res?.key || !res?.url) return null;
	return {
		key: res.key,
		url: res.url,
		bytes: Number(res.bytes ?? 0),
		durationSec:
			typeof res.durationSeconds === "number" && res.durationSeconds > 0
				? res.durationSeconds
				: null,
	};
}

/** 尾帧抽取（media-worker 路径）。 */
export async function extractLastFrameViaMediaWorker(input: {
	videoUrl: string;
	timeoutMs?: number;
}): Promise<{ frameKey: string; frameUrl: string } | null> {
	const res = await callWorker<{ frameKey?: string; frameUrl?: string }>(
		"extractLastFrame",
		{ video: { url: input.videoUrl } },
		input.timeoutMs ?? 5 * 60_000,
		"extractLastFrame",
	);
	if (!res?.frameKey || !res?.frameUrl) return null;
	return { frameKey: res.frameKey, frameUrl: res.frameUrl };
}

/** 按时间戳抽帧（media-worker 路径）。 */
export async function extractFramesAtViaMediaWorker(input: {
	videoUrl: string;
	timesSec: number[];
	timeoutMs?: number;
}): Promise<Array<{
	time: number;
	url: string;
	width?: number;
	height?: number;
}> | null> {
	const res = await callWorker<{ frames?: WorkerFrameAt[] }>(
		"extractFramesAt",
		{ video: { url: input.videoUrl }, timesSec: input.timesSec },
		input.timeoutMs ?? 10 * 60_000,
		"extractFramesAt",
	);
	const frames = res?.frames;
	if (!Array.isArray(frames) || frames.length !== input.timesSec.length) return null;
	const out: Array<{ time: number; url: string; width?: number; height?: number }> = [];
	for (const f of frames) {
		if (!f?.url) return null;
		out.push({
			time: Number(f.timeSec ?? 0),
			url: f.url,
			...(f.width ? { width: Number(f.width) } : {}),
			...(f.height ? { height: Number(f.height) } : {}),
		});
	}
	return out;
}

/** 按显式分段计划切段（media-worker 路径）。 */
export async function splitVideoViaMediaWorker(input: {
	videoUrl: string;
	segments: Array<{ index: number; startSec: number; endSec: number }>;
	timeoutMs?: number;
}): Promise<Array<{
	index: number;
	startSec: number;
	endSec: number;
	url: string;
}> | null> {
	const res = await callWorker<{ segments?: WorkerSplitSegment[] }>(
		"splitVideo",
		{ video: { url: input.videoUrl }, segments: input.segments },
		input.timeoutMs ?? 15 * 60_000,
		"splitVideo",
	);
	const segments = res?.segments;
	if (!Array.isArray(segments) || segments.length !== input.segments.length) return null;
	const out: Array<{ index: number; startSec: number; endSec: number; url: string }> = [];
	for (const s of segments) {
		if (!s?.url) return null;
		out.push({
			index: Number(s.index ?? 0),
			startSec: Number(s.startSec ?? 0),
			endSec: Number(s.endSec ?? 0),
			url: s.url,
		});
	}
	return out;
}

/** 视频理解降分辨率代理片（media-worker 路径）。 */
export async function transcodeProxyViaMediaWorker(input: {
	videoUrl: string;
	timeoutMs?: number;
}): Promise<{ url: string; sizeBytes: number } | null> {
	const res = await callWorker<{ key?: string; url?: string; sizeBytes?: number | string }>(
		"transcodeProxy",
		{ video: { url: input.videoUrl } },
		input.timeoutMs ?? 15 * 60_000,
		"transcodeProxy",
	);
	if (!res?.url) return null;
	return { url: res.url, sizeBytes: Number(res.sizeBytes ?? 0) };
}

/** 视频理解正式预处理路径：任何 worker 或返回契约错误都显式失败。 */
export async function transcodeProxyViaMediaWorkerStrict(input: {
	videoUrl: string;
	timeoutMs?: number;
}): Promise<{ key: string; url: string; sizeBytes: number }> {
	const response = await callWorkerStrict<{
		key?: string;
		url?: string;
		sizeBytes?: number | string;
	}>(
		"transcodeProxy",
		{ video: { url: input.videoUrl } },
		input.timeoutMs ?? 15 * 60_000,
		"transcodeProxy",
	);
	const key = typeof response.key === "string" ? response.key.trim() : "";
	const url = typeof response.url === "string" ? response.url.trim() : "";
	const sizeBytes = Number(response.sizeBytes ?? 0);
	if (!key || !url || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
		throw new Error("media-worker transcodeProxy 返回了无效的 key、url 或 sizeBytes");
	}
	return { key, url, sizeBytes };
}

/** ffprobe 探测（media-worker 路径）。失败/未启用返回 null。 */
export async function probeMediaViaMediaWorker(input: {
	videoR2Key?: string;
	url?: string;
	timeoutMs?: number;
}): Promise<ProbeMediaResult | null> {
	const client = getClient();
	if (!client) return null;
	const source = input.videoR2Key
		? { r2Key: input.videoR2Key }
		: input.url
			? { url: input.url }
			: null;
	if (!source) return null;
	const deadline = new Date(Date.now() + (input.timeoutMs ?? 30_000));
	return new Promise((resolvePromise) => {
		try {
			client.probeMedia({ source }, { deadline }, (err, res) => {
				if (err || !res) {
					if (err) {
						console.warn("[media-worker] probeMedia rpc failed", err.message);
					}
					resolvePromise(null);
					return;
				}
				resolvePromise(res);
			});
		} catch (err) {
			console.warn(
				"[media-worker] probeMedia rpc threw",
				err instanceof Error ? err.message : String(err),
			);
			resolvePromise(null);
		}
	});
}
