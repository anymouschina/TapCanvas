import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import type {
	EndpointRow,
	ProviderRow,
	TokenRow,
	ProxyProviderRow,
} from "../model/model.repo";
import {
	TaskAssetSchema,
	TaskResultSchema,
	type TaskRequestDto,
	TaskStatusSchema,
} from "./task.schemas";
import { emitTaskProgress } from "./task.progress";
import { hostTaskAssetsInWorker } from "../asset/asset.hosting";

type VendorContext = {
	baseUrl: string;
	apiKey: string;
};

type TaskResult = ReturnType<typeof TaskResultSchema.parse>;

type TaskStatus = ReturnType<typeof TaskStatusSchema.parse>;

type ProgressContext = {
	nodeId: string;
	nodeKind?: string;
	taskKind: TaskRequestDto["kind"];
	vendor: string;
};

function extractProgressContext(
	req: TaskRequestDto,
	vendor: string,
): ProgressContext | null {
	const extras = (req.extras || {}) as Record<string, any>;
	const rawNodeId =
		typeof extras.nodeId === "string" ? extras.nodeId.trim() : "";
	if (!rawNodeId) return null;
	const nodeKind =
		typeof extras.nodeKind === "string" ? extras.nodeKind : undefined;
	return {
		nodeId: rawNodeId,
		nodeKind,
		taskKind: req.kind,
		vendor,
	};
}

function emitProgress(
	userId: string,
	ctx: ProgressContext | null,
	event: {
		status: TaskStatus;
		progress?: number;
		message?: string;
		taskId?: string;
		assets?: Array<ReturnType<typeof TaskAssetSchema.parse>>;
		raw?: unknown;
	},
) {
	if (!ctx) return;
	emitTaskProgress(userId, {
		nodeId: ctx.nodeId,
		nodeKind: ctx.nodeKind,
		taskKind: ctx.taskKind,
		vendor: ctx.vendor,
		status: event.status,
		progress: event.progress,
		message: event.message,
		taskId: event.taskId,
		assets: event.assets,
		raw: event.raw,
	});
}

function normalizeBaseUrl(raw: string | null | undefined): string {
	const val = (raw || "").trim();
	if (!val) return "";
	return val.replace(/\/+$/, "");
}

async function resolveProxyForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
): Promise<ProxyProviderRow | null> {
	const v = vendor.toLowerCase();

	// 1) Direct match on vendor (for legacy configs)
	const directRes = await c.env.DB.prepare(
		`SELECT * FROM proxy_providers
     WHERE owner_id = ? AND vendor = ? AND enabled = 1`,
	)
		.bind(userId, v)
		.all<ProxyProviderRow>();
	const direct = directRes.results || [];

	// 2) Match via enabled_vendors JSON (recommended)
	const viaEnabledRes = await c.env.DB.prepare(
		`SELECT * FROM proxy_providers
     WHERE owner_id = ? AND enabled = 1
       AND enabled_vendors IS NOT NULL
       AND enabled_vendors LIKE ?`,
	)
		.bind(userId, `%"${v}"%`)
		.all<ProxyProviderRow>();
	const viaEnabled = viaEnabledRes.results || [];

	const all: ProxyProviderRow[] = [];
	for (const row of direct) {
		all.push(row);
	}
	for (const row of viaEnabled) {
		if (!all.find((r) => r.id === row.id)) {
			all.push(row);
		}
	}
	if (!all.length) return null;

	// Prefer GRSAI proxy when available
	const preferred =
		all.find((row) => row.vendor === "grsai") ||
		all[0];
	return preferred;
}

async function resolveVendorContext(
	c: AppContext,
	userId: string,
	vendor: string,
): Promise<VendorContext> {
	const v = vendor.toLowerCase();

	// 1) Try user-level proxy config (proxy_providers + enabled_vendors)
	const proxy = await resolveProxyForVendor(c, userId, v);

	if (proxy && proxy.enabled === 1) {
		const baseUrl = normalizeBaseUrl(proxy.base_url);
		const apiKey = (proxy.api_key || "").trim();
		if (!baseUrl || !apiKey) {
			throw new AppError("Proxy for vendor is misconfigured", {
				status: 400,
				code: "proxy_misconfigured",
			});
		}
		return { baseUrl, apiKey };
	}

	// 2) Fallback to model_providers + model_tokens
	const providers = await c.env.DB.prepare(
		`SELECT * FROM model_providers WHERE owner_id = ? AND vendor = ? ORDER BY created_at ASC`,
	)
		.bind(userId, v)
		.all<ProviderRow>()
		.then((r) => r.results || []);

	if (!providers.length) {
		throw new AppError(`No provider configured for vendor ${v}`, {
			status: 400,
			code: "provider_not_configured",
		});
	}

	const provider = providers[0];

	// Find best token for provider: prefer user-owned enabled, then shared enabled
	const ownedRows = await c.env.DB.prepare(
		`SELECT * FROM model_tokens
     WHERE provider_id = ? AND user_id = ? AND enabled = 1
     ORDER BY created_at ASC LIMIT 1`,
	)
		.bind(provider.id, userId)
		.all<TokenRow>();
	let token: TokenRow | null = (ownedRows.results || [])[0] ?? null;

	if (!token) {
		const nowIso = new Date().toISOString();
		const sharedRows = await c.env.DB.prepare(
			`SELECT * FROM model_tokens
       WHERE provider_id = ? AND shared = 1 AND enabled = 1
         AND (shared_disabled_until IS NULL OR shared_disabled_until < ?)
       ORDER BY updated_at ASC LIMIT 1`,
		)
			.bind(provider.id, nowIso)
			.all<TokenRow>();
		token = (sharedRows.results || [])[0] ?? null;
	}

	const apiKey = (token?.secret_token || "").trim();
	if (!apiKey) {
		throw new AppError(`No API key configured for vendor ${v}`, {
			status: 400,
			code: "api_key_missing",
		});
	}

	const baseUrl = normalizeBaseUrl(
		provider.base_url ||
			(await resolveSharedBaseUrl(c, v)) ||
			(v === "veo"
				? "https://api.grsai.com"
				: v === "sora2api"
					? "http://localhost:8000"
					: ""),
	);

	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}

	return { baseUrl, apiKey };
}

async function resolveSharedBaseUrl(
	c: AppContext,
	vendor: string,
): Promise<string | null> {
	const row = await c.env.DB.prepare(
		`SELECT base_url FROM model_providers
     WHERE vendor = ? AND shared_base_url = 1 AND base_url IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
	)
		.bind(vendor)
		.first<{ base_url: string | null }>();
	return row?.base_url ?? null;
}

// ---------- VEO ----------

function normalizeVeoModelKey(modelKey?: string | null): string {
	if (!modelKey) return "veo3.1-fast";
	const trimmed = modelKey.trim();
	if (!trimmed) return "veo3.1-fast";
	return trimmed.startsWith("models/") ? trimmed.slice(7) : trimmed;
}

function clampProgress(value?: number | null): number | undefined {
	if (typeof value !== "number" || Number.isNaN(value)) return undefined;
	return Math.max(0, Math.min(100, value));
}

function mapTaskStatus(status?: string | null): "running" | "succeeded" | "failed" {
	const normalized = typeof status === "string" ? status.toLowerCase() : null;
	if (normalized === "failed") return "failed";
	if (normalized === "succeeded") return "succeeded";
	return "running";
}

function extractVeoResultPayload(body: any): any {
	if (!body) return null;
	if (typeof body === "object" && body.data) return body.data;
	return body;
}

export async function runVeoVideoTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const progressCtx = extractProgressContext(req, "veo");
	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

	const ctx = await resolveVendorContext(c, userId, "veo");
	const baseUrl = normalizeBaseUrl(ctx.baseUrl) || "https://api.grsai.com";
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 Veo API Key", {
			status: 400,
			code: "veo_api_key_missing",
		});
	}

	const extras = (req.extras || {}) as Record<string, any>;
	const model = normalizeVeoModelKey(
		(typeof extras.modelKey === "string" && extras.modelKey) ||
			(req.extras && (req.extras as any).modelKey) ||
			null,
	);

	const aspectRatio =
		typeof extras.aspectRatio === "string" && extras.aspectRatio.trim()
			? extras.aspectRatio.trim()
			: "16:9";

	const urls: string[] = [];
	const appendUrl = (value: any) => {
		if (typeof value === "string" && value.trim()) {
			urls.push(value.trim());
		}
	};
	if (Array.isArray(extras.urls)) extras.urls.forEach(appendUrl);
	if (Array.isArray(extras.referenceImages))
		extras.referenceImages.forEach(appendUrl);
	const referenceImages = Array.from(new Set(urls)).slice(0, 3);

	const firstFrameUrl =
		typeof extras.firstFrameUrl === "string" && extras.firstFrameUrl.trim()
			? extras.firstFrameUrl.trim()
			: undefined;
	const lastFrameUrl =
		typeof extras.lastFrameUrl === "string" && extras.lastFrameUrl.trim()
			? extras.lastFrameUrl.trim()
			: undefined;

	const body: Record<string, any> = {
		model,
		prompt: req.prompt,
		aspectRatio,
		webHook: "-1",
		shutProgress: extras.shutProgress === false ? false : true,
	};

	if (referenceImages.length) {
		body.urls = referenceImages;
	}
	if (firstFrameUrl) {
		body.firstFrameUrl = firstFrameUrl;
		if (lastFrameUrl) {
			body.lastFrameUrl = lastFrameUrl;
		}
	}

	let res: Response;
	let data: any = null;
	try {
		emitProgress(userId, progressCtx, { status: "running", progress: 5 });
		res = await fetch(`${baseUrl}/v1/video/veo`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		});
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("Veo 视频任务创建失败", {
			status: 502,
			code: "veo_request_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(data && (data.message || data.error || data.msg)) ||
			`Veo 视频任务创建失败：${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "veo_request_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	if (typeof data?.code === "number" && data.code !== 0) {
		const msg = data?.msg || data?.message || "Veo 视频任务创建失败";
		throw new AppError(msg, {
			status: 502,
			code: "veo_request_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const payload = typeof data?.code === "number" ? data.data : data;
	const taskId = payload?.id;
	if (!taskId || typeof taskId !== "string" || !taskId.trim()) {
		throw new AppError("Veo API 未返回任务 ID", {
			status: 502,
			code: "veo_task_id_missing",
		});
	}

	emitProgress(userId, progressCtx, {
		status: "running",
		progress: 10,
		taskId,
		raw: payload,
	});

	// Worker 侧只做「创建任务 + 返回 running」，结果由 /tasks/veo/result 查询
	return TaskResultSchema.parse({
		id: taskId,
		kind: "text_to_video",
		status: "running",
		assets: [],
		raw: {
			provider: "veo",
			model,
			taskId,
			response: payload,
		},
	});
}

export async function fetchVeoTaskResult(
	c: AppContext,
	userId: string,
	taskId: string,
) {
	if (!taskId || !taskId.trim()) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "task_id_required",
		});
	}
	const ctx = await resolveVendorContext(c, userId, "veo");
	const baseUrl = normalizeBaseUrl(ctx.baseUrl) || "https://api.grsai.com";
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 Veo API Key", {
			status: 400,
			code: "veo_api_key_missing",
		});
	}

	let res: Response;
	let data: any = null;
	try {
		res = await fetch(`${baseUrl}/v1/draw/result`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ id: taskId.trim() }),
		});
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("Veo 结果查询失败", {
			status: 502,
			code: "veo_result_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(data && (data.message || data.error || data.msg)) ||
			`Veo result poll failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "veo_result_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const payload = extractVeoResultPayload(data);
	if (!payload) {
		return TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "running",
			assets: [],
			raw: {
				provider: "veo",
				response: data,
			},
		});
	}

	const status = mapTaskStatus(payload.status);
	const progress = clampProgress(payload.progress);

	if (status === "failed") {
		const errMsg =
			payload.failure_reason || payload.error || "Veo 视频任务失败";
		throw new AppError(errMsg, {
			status: 502,
			code: "veo_result_failed",
			details: { upstreamData: payload },
		});
	}

	if (status === "succeeded") {
		const videoUrl =
			typeof payload.url === "string" && payload.url.trim()
				? payload.url.trim()
				: null;
		if (!videoUrl) {
			return TaskResultSchema.parse({
				id: taskId,
				kind: "text_to_video",
				status: "running",
				assets: [],
				raw: {
					provider: "veo",
					response: payload,
					progress,
				},
			});
		}
		const asset = TaskAssetSchema.parse({
			type: "video",
			url: videoUrl,
			thumbnailUrl:
				payload.thumbnailUrl || payload.thumbnail_url || null,
		});

		const hostedAssets = await hostTaskAssetsInWorker({
			c,
			userId,
			assets: [asset],
			meta: {
				taskKind: "text_to_video",
				prompt: null,
				vendor: "veo",
				modelKey:
					typeof payload.model === "string"
						? payload.model
						: undefined,
			},
		});

		return TaskResultSchema.parse({
			id: payload.id || taskId,
			kind: "text_to_video",
			status: "succeeded",
			assets: hostedAssets,
			raw: {
				provider: "veo",
				response: payload,
			},
		});
	}

	return TaskResultSchema.parse({
		id: taskId,
		kind: "text_to_video",
		status,
		assets: [],
		raw: {
			provider: "veo",
			response: payload,
			progress,
		},
	});
}

// ---------- Sora2API ----------

function normalizeSora2ApiModelKey(
	modelKey?: string | null,
	orientation?: "portrait" | "landscape",
	durationSeconds?: number | null,
): string {
	const trimmed = (modelKey || "").trim();
	if (trimmed && /^sora-(image|video)/i.test(trimmed)) {
		return trimmed;
	}
	const duration =
		typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
			? durationSeconds
			: 10;
	const isShort = duration <= 10;
	const orient = orientation === "portrait" ? "portrait" : "landscape";
	if (orient === "portrait") {
		return isShort
			? "sora-video-portrait-10s"
			: "sora-video-portrait-15s";
	}
	return isShort
		? "sora-video-landscape-10s"
		: "sora-video-landscape-15s";
}

export async function runSora2ApiVideoTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const progressCtx = extractProgressContext(req, "sora2api");
	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

	const ctx = await resolveVendorContext(c, userId, "sora2api");
	const baseUrl =
		normalizeBaseUrl(ctx.baseUrl) || "http://localhost:8000";
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 sora2api API Key", {
			status: 400,
			code: "sora2api_api_key_missing",
		});
	}

	const extras = (req.extras || {}) as Record<string, any>;
	const orientationRaw =
		(typeof extras.orientation === "string" && extras.orientation.trim()) ||
		(typeof req.extras?.orientation === "string" &&
			(req.extras as any).orientation) ||
		"landscape";
	const orientation =
		orientationRaw === "portrait" ? "portrait" : "landscape";
	const durationSeconds =
		typeof (req as any).durationSeconds === "number" &&
		Number.isFinite((req as any).durationSeconds)
			? (req as any).durationSeconds
			: typeof extras.durationSeconds === "number" &&
					Number.isFinite(extras.durationSeconds)
				? extras.durationSeconds
				: 10;

	const model = normalizeSora2ApiModelKey(
		typeof extras.modelKey === "string" ? extras.modelKey : ctx.baseUrl,
		orientation,
		durationSeconds,
	);

	const body = {
		model,
		prompt: req.prompt,
		durationSeconds,
		orientation,
	};

	let res: Response;
	let data: any = null;
	try {
		emitProgress(userId, progressCtx, { status: "running", progress: 5 });
		res = await fetch(`${baseUrl}/v1/video/tasks`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		});
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("sora2api 调用失败", {
			status: 502,
			code: "sora2api_request_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(data &&
				(data.error?.message ||
					data.message ||
					data.error)) ||
			`sora2api 调用失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora2api_request_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const id =
		typeof data?.id === "string" && data.id.trim()
			? data.id.trim()
			: null;
	if (!id) {
		throw new AppError("sora2api 未返回任务 ID", {
			status: 502,
			code: "sora2api_task_id_missing",
		});
	}

	const status = mapTaskStatus(data.status || "queued");
	const progress = clampProgress(
		typeof data.progress === "number"
			? data.progress
			: typeof data.progress_pct === "number"
				? data.progress_pct * 100
				: undefined,
	);

	return TaskResultSchema.parse({
		id,
		kind: "text_to_video",
			status,
			taskId: id,
			assets: [],
			raw: {
			provider: "sora2api",
			model,
			taskId: id,
			status,
			progress: progress ?? null,
		},
	});
}

export async function fetchSora2ApiTaskResult(
	c: AppContext,
	userId: string,
	taskId: string,
) {
	if (!taskId || !taskId.trim()) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "task_id_required",
		});
	}
	const ctx = await resolveVendorContext(c, userId, "sora2api");
	const baseUrl =
		normalizeBaseUrl(ctx.baseUrl) || "http://localhost:8000";
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 sora2api API Key", {
			status: 400,
			code: "sora2api_api_key_missing",
		});
	}

	let res: Response;
	let data: any = null;
	try {
		res = await fetch(
			`${baseUrl}/v1/video/tasks/${encodeURIComponent(taskId.trim())}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			},
		);
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("sora2api 任务查询失败", {
			status: 502,
			code: "sora2api_result_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(data &&
				(data.error?.message ||
					data.message ||
					data.error)) ||
			`sora2api 任务查询失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora2api_result_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const status = mapTaskStatus(data.status);
	const progress = clampProgress(
		typeof data.progress === "number"
			? data.progress
			: typeof data.progress_pct === "number"
				? data.progress_pct * 100
				: undefined,
	);

	let assetPayload: any = undefined;

	if (status === "succeeded") {
		const directVideo =
			(typeof data.video_url === "string" && data.video_url.trim()) ||
			(typeof data.videoUrl === "string" && data.videoUrl.trim()) ||
			null;
		let videoUrl: string | null = directVideo;

		if (!videoUrl && typeof data.content === "string") {
			const match = data.content.match(
				/<video[^>]+src=['"]([^'"]+)['"][^>]*>/i,
			);
			if (match && match[1] && match[1].trim()) {
				videoUrl = match[1].trim();
			}
		}

		if (!videoUrl && typeof data.content === "string") {
			const urls = new Set<string>();
			const regex = /!\[[^\]]*]\(([^)]+)\)/g;
			let m: RegExpExecArray | null;
			// eslint-disable-next-line no-cond-assign
			while ((m = regex.exec(data.content)) !== null) {
				const url = (m[1] || "").trim();
				if (url) urls.add(url);
			}
			const images = Array.from(urls);
			if (images.length) {
				assetPayload = {
					type: "image",
					url: images[0],
					thumbnailUrl: null,
				};
			}
		} else if (videoUrl) {
			const thumbnail =
				(typeof data.thumbnail_url === "string" &&
					data.thumbnail_url.trim()) ||
				(typeof data.thumbnailUrl === "string" &&
					data.thumbnailUrl.trim()) ||
				null;
			assetPayload = {
				type: "video",
				url: videoUrl,
				thumbnailUrl: thumbnail,
			};
		}
	}

	if (assetPayload) {
		const asset = TaskAssetSchema.parse(assetPayload);

		const hostedAssets = await hostTaskAssetsInWorker({
			c,
			userId,
			assets: [asset],
			meta: {
				taskKind: "text_to_video",
				prompt: null,
				vendor: "sora2api",
				modelKey:
					typeof data.model === "string" ? data.model : undefined,
			},
		});

		return TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "succeeded",
			assets: hostedAssets,
			raw: {
				provider: "sora2api",
				response: data,
			},
		});
	}

	return TaskResultSchema.parse({
		id: taskId,
		kind: "text_to_video",
		status,
		assets: [],
		raw: {
			provider: "sora2api",
			response: data,
			progress,
		},
	});
}

// ---------- Generic text/image tasks (openai / gemini / qwen / anthropic) ----------

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function normalizeTemperature(input: unknown, fallback: number): number {
	if (typeof input !== "number" || Number.isNaN(input)) return fallback;
	return clamp01(input);
}

// ---- OpenAI / Codex responses helpers (align with Nest openaiAdapter) ----

type OpenAIContentPartForTask =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } | string };

type OpenAIChatMessageForTask = {
	role: string;
	content: string | OpenAIContentPartForTask[];
};

function normalizeOpenAIBaseForTask(baseUrl?: string | null): string {
	const raw = (baseUrl || "https://api.openai.com").trim();
	return raw.replace(/\/+$/, "");
}

function buildOpenAIResponsesUrlForTask(baseUrl?: string | null): string {
	const normalized = normalizeOpenAIBaseForTask(baseUrl);
	if (/\/responses$/i.test(normalized)) {
		return normalized;
	}
	const hasVersion = /\/v\d+(?:beta)?$/i.test(normalized);
	return `${normalized}${hasVersion ? "" : "/v1"}/responses`;
}

function normalizeMessageContentForResponses(
	content: string | OpenAIContentPartForTask[],
): OpenAIContentPartForTask[] {
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	return content;
}

function convertPartForResponses(
	part: OpenAIContentPartForTask,
): { type: string; [key: string]: any } {
	if (part.type === "text") {
		return { type: "input_text", text: (part as any).text ?? "" };
	}
	if (part.type === "image_url") {
		const source =
			typeof (part as any).image_url === "string"
				? (part as any).image_url
				: (part as any).image_url?.url;
		return { type: "input_image", image_url: source || "" };
	}
	return part as any;
}

function convertMessagesToResponsesInput(
	messages: OpenAIChatMessageForTask[],
) {
	return messages.map((msg) => ({
		role: msg.role,
		content: normalizeMessageContentForResponses(
			msg.content,
		).map(convertPartForResponses),
	}));
}

function extractTextFromOpenAIResponseForTask(raw: any): string {
	// 兼容传统 chat.completions 结构
	if (Array.isArray(raw?.choices)) {
		const choice = raw.choices[0];
		const message = choice?.message;
		if (Array.isArray(message?.content)) {
			return message.content
				.map((part: any) =>
					typeof part?.text === "string"
						? part.text
						: part?.content || "",
				)
				.join("")
				.trim();
		}
		if (typeof message?.content === "string") {
			return message.content.trim();
		}
	}

	// 兼容 responses 格式：output / output_text
	const output = raw?.output;
	if (Array.isArray(output)) {
		const buffer: string[] = [];
		output.forEach((entry: any) => {
			if (Array.isArray(entry?.content)) {
				entry.content.forEach((part: any) => {
					if (typeof part?.text === "string") {
						buffer.push(part.text);
					} else if (typeof part?.content === "string") {
						buffer.push(part.content);
					} else if (typeof part?.output_text === "string") {
						buffer.push(part.output_text);
					}
				});
			}
		});
		const merged = buffer.join("").trim();
		if (merged) return merged;
	}

	if (Array.isArray(raw?.output_text)) {
		const merged = raw.output_text
			.filter((v: any) => typeof v === "string")
			.join("")
			.trim();
		if (merged) return merged;
	}

	if (typeof raw?.text === "string") {
		return raw.text.trim();
	}

	return "";
}

function normalizeImagePromptOutputForTask(text: string): string {
	if (!text) return "";
	let normalized = text.trim();

	// Strip common "Prompt" labels and Markdown headings at the beginning.
	normalized = normalized.replace(
		/^\s*\*{0,2}\s*prompt\s*\*{0,2}\s*[-:]\s*/i,
		"",
	);

	// Remove surrounding quotes if the whole output is quoted.
	if (
		(normalized.startsWith('"') && normalized.endsWith('"')) ||
		(normalized.startsWith("'") && normalized.endsWith("'"))
	) {
		normalized = normalized.slice(1, -1).trim();
	}

	return normalized.trim();
}

function pickModelKey(
	req: TaskRequestDto,
	ctx: { modelKey?: string | null },
): string | undefined {
	const extras = (req.extras || {}) as Record<string, any>;
	const explicit =
		typeof extras.modelKey === "string" && extras.modelKey.trim()
			? extras.modelKey.trim()
			: undefined;
	if (explicit) return explicit;
	if (ctx.modelKey && ctx.modelKey.trim()) return ctx.modelKey.trim();
	return undefined;
}

function pickSystemPrompt(
	req: TaskRequestDto,
	defaultPrompt: string,
): string {
	const extras = (req.extras || {}) as Record<string, any>;
	const explicit =
		typeof extras.systemPrompt === "string" && extras.systemPrompt.trim()
			? extras.systemPrompt.trim()
			: null;
	if (explicit) return explicit;
	return defaultPrompt;
}

async function callJsonApi(
	url: string,
	init: RequestInit,
	errorContext: { provider: string },
): Promise<any> {
	let res: Response;
	try {
		res = await fetch(url, init);
	} catch (error: any) {
		throw new AppError(`${errorContext.provider} 请求失败`, {
			status: 502,
			code: `${errorContext.provider}_request_failed`,
			details: { message: error?.message ?? String(error) },
		});
	}

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(data && (data.error?.message || data.message || data.error)) ||
			`${errorContext.provider} 调用失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: `${errorContext.provider}_request_failed`,
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	return data;
}

function safeParseJsonForTask(data: string): any | null {
	try {
		return JSON.parse(data);
	} catch {
		return null;
	}
}

// 解析 Codex / OpenAI Responses SSE 文本，提取最终的 completed response
function parseSseResponseForTask(raw: string): any | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	const chunks = raw.split(/\n\n+/);
	let completedResponse: any = null;
	let aggregatedText = "";

	chunks.forEach((chunk) => {
		const trimmed = chunk.trim();
		if (!trimmed) return;

		const dataLines = trimmed
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.filter(Boolean);
		if (!dataLines.length) return;

		const payload = safeParseJsonForTask(dataLines.join("\n"));
		if (!payload || typeof payload !== "object") return;

		if (payload.type === "response.completed" && payload.response) {
			completedResponse = payload.response;
			return;
		}

		if (
			payload.type === "response.output_text.delta" &&
			typeof payload.delta === "string"
		) {
			aggregatedText += payload.delta;
		}

		if (!aggregatedText) {
			if (
				payload.type === "response.output_text.done" &&
				typeof payload.text === "string"
			) {
				aggregatedText = payload.text;
			} else if (
				payload.type === "response.content_part.done" &&
				payload.part &&
				typeof payload.part.text === "string"
			) {
				aggregatedText = payload.part.text;
			}
		}
	});

	if (completedResponse) return completedResponse;
	if (aggregatedText) {
		return {
			text: aggregatedText,
			output_text: [aggregatedText],
		};
	}
	return null;
}

// 专用于 OpenAI/Codex responses 端点，保留原始文本以便调试和前端展示
async function callOpenAIResponsesForTask(
	url: string,
	apiKey: string,
	body: Record<string, any>,
): Promise<{ parsed: any; rawBody: string }> {
	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		});
	} catch (error: any) {
		throw new AppError("openai 请求失败", {
			status: 502,
			code: "openai_request_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	let rawText = "";
	try {
		rawText = await res.text();
	} catch {
		rawText = "";
	}

	let parsed: any = null;
	if (rawText && rawText.trim()) {
		// 优先尝试按 SSE 流解析（Codex 默认），失败再退回普通 JSON。
		parsed = parseSseResponseForTask(rawText) || safeParseJsonForTask(rawText);
	}

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(parsed &&
				(parsed.error?.message ||
					parsed.message ||
					parsed.error)) ||
			`openai 调用失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "openai_request_failed",
			details: {
				upstreamStatus: res.status,
				upstreamData: parsed ?? rawText ?? null,
			},
		});
	}

	return { parsed, rawBody: rawText };
}

// ---- OpenAI text (chat / prompt_refine) ----

async function runOpenAiTextTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
	): Promise<TaskResult> {
		const ctx = await resolveVendorContext(c, userId, "openai");
		const responsesUrl = buildOpenAIResponsesUrlForTask(ctx.baseUrl);
		const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 OpenAI API Key", {
			status: 400,
			code: "openai_api_key_missing",
		});
	}

	const model =
		pickModelKey(req, { modelKey: undefined }) ||
		"gpt-5.1-codex";

	const extras = (req.extras || {}) as Record<string, any>;

	const systemPrompt =
		req.kind === "prompt_refine"
			? pickSystemPrompt(
					req,
					"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
				)
			: pickSystemPrompt(req, "");

	const temperature = normalizeTemperature(extras.temperature, 0.7);

	const messages: OpenAIChatMessageForTask[] = [];
	if (systemPrompt) {
		messages.push({ role: "system", content: systemPrompt });
	}
	messages.push({ role: "user", content: req.prompt });

		const input = convertMessagesToResponsesInput(messages);
		const body = {
			model,
			input,
			max_output_tokens: 800,
			stream: false,
			temperature,
		};

		const { parsed, rawBody } = await callOpenAIResponsesForTask(
			responsesUrl,
			apiKey,
			body,
		);

		const text =
			extractTextFromOpenAIResponseForTask(parsed) ||
			(typeof rawBody === "string" ? rawBody.trim() : "");

		const id =
			(typeof parsed?.id === "string" && parsed.id.trim()) ||
			`openai-${Date.now().toString(36)}`;

	return TaskResultSchema.parse({
		id,
		kind: req.kind,
		status: "succeeded",
		assets: [],
		raw: {
				provider: "openai",
				response: parsed,
				rawBody,
				text,
			},
		});
}

// ---- OpenAI image_to_prompt ----

async function runOpenAiImageToPromptTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
	): Promise<TaskResult> {
	const ctx = await resolveVendorContext(c, userId, "openai");
	const responsesUrl = buildOpenAIResponsesUrlForTask(ctx.baseUrl);
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 OpenAI API Key", {
			status: 400,
			code: "openai_api_key_missing",
		});
	}

	const extras = (req.extras || {}) as Record<string, any>;
	const imageData =
		typeof extras.imageData === "string" && extras.imageData.trim()
			? extras.imageData.trim()
			: null;
	const imageUrl =
		typeof extras.imageUrl === "string" && extras.imageUrl.trim()
			? extras.imageUrl.trim()
			: null;

	if (!imageData && !imageUrl) {
		throw new AppError("imageUrl 或 imageData 必须提供一个", {
			status: 400,
			code: "image_source_missing",
		});
	}

	const model =
		pickModelKey(req, { modelKey: undefined }) ||
		"gpt-5.1-codex";

	const userPrompt =
		req.prompt?.trim() ||
		"Describe this image in rich detail and output a single, well-structured English prompt that can be used to recreate it. Do not add any explanations, headings, markdown formatting, or non-English text.";

	const systemPrompt = pickSystemPrompt(
		req,
		"You are an expert prompt engineer. When a user provides an image, you must return a single detailed English prompt that can be used to recreate it. Describe subjects, environment, composition, camera, lighting, and style cues. Do not add explanations, headings, markdown, or any non-English text; output only the final English prompt.",
	);

	const parts: any[] = [];
	if (systemPrompt) {
		parts.push({ type: "text", text: systemPrompt });
	}
	parts.push({ type: "text", text: userPrompt });
	const imageSource = imageData || imageUrl!;
	parts.push({
		type: "image_url",
		image_url: { url: imageSource },
	});

		const messages: OpenAIChatMessageForTask[] = [
			{
				role: "user",
				content: parts,
			},
		];

		const input = convertMessagesToResponsesInput(messages);
		const body = {
			model,
			input,
			max_output_tokens: 800,
			stream: false,
			temperature: 0.2,
		};

		const { parsed, rawBody } = await callOpenAIResponsesForTask(
			responsesUrl,
			apiKey,
			body,
		);

		const rawText =
			extractTextFromOpenAIResponseForTask(parsed) ||
			(typeof rawBody === "string" ? rawBody.trim() : "");

		const text = normalizeImagePromptOutputForTask(rawText);

		const id =
			(typeof parsed?.id === "string" && parsed.id.trim()) ||
			`openai-img-${Date.now().toString(36)}`;

	return TaskResultSchema.parse({
		id,
		kind: "image_to_prompt",
		status: "succeeded",
		assets: [],
			raw: {
				provider: "openai",
				response: parsed,
				rawBody,
				text,
				imageSource,
			},
	});
}

// ---- Gemini / Banana 文案 ----

async function runGeminiTextTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const ctx = await resolveVendorContext(c, userId, "gemini");
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 Gemini API Key", {
			status: 400,
			code: "gemini_api_key_missing",
		});
	}

	const base = normalizeBaseUrl(ctx.baseUrl) ||
		"https://generativelanguage.googleapis.com";
	const extras = (req.extras || {}) as Record<string, any>;
	const modelKey =
		pickModelKey(req, { modelKey: undefined }) || "models/gemini-2.5-flash";
	const model = modelKey.startsWith("models/")
		? modelKey
		: `models/${modelKey}`;

	const systemPrompt =
		req.kind === "prompt_refine"
			? pickSystemPrompt(
					req,
					"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
				)
			: pickSystemPrompt(req, "");

	const contents: any[] = [];
	if (systemPrompt) {
		contents.push({
			role: "user",
			parts: [{ text: systemPrompt }],
		});
	}
	contents.push({
		role: "user",
		parts: [{ text: req.prompt }],
	});

	const url = `${base.replace(/\/+$/, "")}/v1beta/${model}:generateContent?key=${encodeURIComponent(
		apiKey,
	)}`;

	const data = await callJsonApi(
		url,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ contents }),
		},
		{ provider: "gemini" },
	);

	const firstCandidate = Array.isArray(data?.candidates)
		? data.candidates[0]
		: null;
	const parts = Array.isArray(firstCandidate?.content?.parts)
		? firstCandidate.content.parts
		: [];
	const text = parts
		.map((p: any) =>
			typeof p?.text === "string" ? p.text : "",
		)
		.join("")
		.trim();

	const id = `gemini-${Date.now().toString(36)}`;

	return TaskResultSchema.parse({
		id,
		kind: req.kind,
		status: "succeeded",
		assets: [],
		raw: {
			provider: "gemini",
			response: data,
			text,
		},
	});
}

// ---- Gemini / Banana 图像（text_to_image / image_edit） ----

const BANANA_MODELS = new Set([
	"nano-banana",
	"nano-banana-fast",
	"nano-banana-pro",
]);

function normalizeBananaModelKey(modelKey?: string | null): string | null {
	if (!modelKey) return null;
	const trimmed = modelKey.trim();
	if (!trimmed) return null;
	return trimmed.startsWith("models/") ? trimmed.slice(7) : trimmed;
}

function parseBananaSseEvents(raw: string): any[] {
	if (!raw || typeof raw !== "string") return [];
	const normalized = raw.replace(/\r/g, "");
	const chunks = normalized.split(/\n\n+/);
	const events: any[] = [];
	for (const chunk of chunks) {
		const trimmedChunk = chunk.trim();
		if (!trimmedChunk) continue;
		const lines = trimmedChunk.split("\n");
		for (const line of lines) {
			const match = line.match(/^\s*data:\s*(.+)$/i);
			if (!match) continue;
			const payload = match[1].trim();
			if (!payload || payload === "[DONE]") continue;
			try {
				events.push(JSON.parse(payload));
			} catch {
				// ignore malformed lines
			}
		}
	}
	return events;
}

function normalizeBananaResponse(data: any): {
	payload: any;
	events: any[];
	raw: any;
} {
	if (data === null || data === undefined) {
		return { payload: null, events: [], raw: data };
	}

	const tryParseJson = (value: string) => {
		try {
			return JSON.parse(value);
		} catch {
			return null;
		}
	};

	if (typeof data === "string") {
		const events = parseBananaSseEvents(data);
		if (events.length) {
			return { payload: events[events.length - 1], events, raw: data };
		}
		const parsed = tryParseJson(data);
		return { payload: parsed, events: [], raw: data };
	}

	if (typeof data === "object") {
		if (typeof data.data === "string") {
			const events = parseBananaSseEvents(data.data);
			if (events.length) {
				return {
					payload: events[events.length - 1],
					events,
					raw: data.data,
				};
			}
			const parsed = tryParseJson(data.data);
			return { payload: parsed, events: [], raw: data.data };
		}
		if (data.data && typeof data.data === "object") {
			return { payload: data.data, events: [], raw: data };
		}
	}

	return { payload: data, events: [], raw: data };
}

function extractBananaImageUrls(payload: any): string[] {
	if (!payload || typeof payload !== "object") return [];
	const urls = new Set<string>();
	const enqueue = (value: any) => {
		if (!value) return;
		const arr = Array.isArray(value) ? value : [value];
		for (const item of arr) {
			const candidate = (() => {
				if (!item) return null;
				if (typeof item === "string") return item.trim();
				if (typeof item !== "object") return null;
				const urlKeys = [
					"url",
					"uri",
					"href",
					"imageUrl",
					"image_url",
					"image",
					"image_path",
					"path",
					"resultUrl",
					"result_url",
					"fileUrl",
					"file_url",
					"cdn",
				];
				for (const key of urlKeys) {
					const val = (item as any)[key];
					if (typeof val === "string" && val.trim()) {
						return val.trim();
					}
				}
				const base64Keys = ["base64", "b64_json", "image_base64"];
				for (const key of base64Keys) {
					const val = (item as any)[key];
					if (typeof val === "string" && val.trim()) {
						return `data:image/png;base64,${val.trim()}`;
					}
				}
				return null;
			})();
			if (candidate) {
				urls.add(candidate);
			}
		}
	};

	const candidates = [
		payload?.results,
		payload?.images,
		payload?.imageUrls,
		payload?.image_urls,
		payload?.image_paths,
		payload?.outputs,
		payload?.output?.results,
		payload?.output?.images,
		payload?.output?.imageUrls,
		payload?.output?.image_urls,
	];
	candidates.forEach(enqueue);

	enqueue(payload);
	enqueue(payload?.output);

	const directValues = [
		payload?.url,
		payload?.imageUrl,
		payload?.image_url,
		payload?.resultUrl,
		payload?.result_url,
		payload?.fileUrl,
		payload?.file_url,
	];
	directValues.forEach((value) => {
		if (typeof value === "string" && value.trim()) {
			urls.add(value.trim());
		}
	});

	return Array.from(urls);
}

async function runGeminiBananaImageTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const ctx = await resolveVendorContext(c, userId, "gemini");
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 grsai API Key", {
			status: 400,
			code: "banana_api_key_missing",
		});
	}

	const extras = (req.extras || {}) as Record<string, any>;
	const modelKeyOverride =
		typeof extras.modelKey === "string" ? extras.modelKey : undefined;
	const normalizedModel =
		normalizeBananaModelKey(modelKeyOverride) ||
		"nano-banana-fast";

	if (!BANANA_MODELS.has(normalizedModel)) {
		throw new AppError("当前模型不支持 Banana 图片接口", {
			status: 400,
			code: "banana_model_not_supported",
		});
	}

	const baseUrl =
		normalizeBaseUrl(ctx.baseUrl) || "https://api.grsai.com";
	const endpoint = `${baseUrl}/v1/draw/nano-banana`;

	const referenceImages: string[] = Array.isArray(extras.referenceImages)
		? extras.referenceImages
				.map((url: any) =>
					typeof url === "string" ? url.trim() : "",
				)
				.filter((url: string) => url.length > 0)
		: [];

	const aspectRatio =
		typeof extras.aspectRatio === "string" && extras.aspectRatio.trim()
			? extras.aspectRatio.trim()
			: "auto";

	const imageSize =
		typeof extras.imageSize === "string" && extras.imageSize.trim()
			? extras.imageSize.trim()
			: undefined;

	const shouldStreamProgress =
		extras.shutProgress === true ? false : true;

	const body: any = {
		model: normalizedModel,
		prompt: req.prompt,
		aspectRatio,
		// 默认启用 Banana 侧进度流（与 Nest 保持一致），
		// 但允许通过 extras.shutProgress === true 显式关闭。
		shutProgress: shouldStreamProgress ? false : true,
	};
	if (imageSize) {
		body.imageSize = imageSize;
	}
	if (referenceImages.length) {
		body.urls = referenceImages;
	}
	if (typeof extras.webHook === "string" && extras.webHook.trim()) {
		body.webHook = extras.webHook.trim();
	}

	let res: Response;
	let data: any = null;
	try {
		res = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: shouldStreamProgress
					? "text/event-stream,application/json"
					: "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		});
		const ct = (res.headers.get("content-type") || "").toLowerCase();
		if (ct.includes("application/json")) {
			try {
				data = await res.json();
			} catch {
				data = null;
			}
		} else {
			try {
				data = await res.text();
			} catch {
				data = null;
			}
		}
	} catch (error: any) {
		throw new AppError("Banana 图像生成请求失败", {
			status: 502,
			code: "banana_request_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (!res.ok || (typeof data?.code === "number" && data.code !== 0)) {
		const normalizedError = normalizeBananaResponse(data);
		const msg =
			(normalizedError.payload &&
				(normalizedError.payload.msg ||
					normalizedError.payload.message ||
					normalizedError.payload.error ||
					normalizedError.payload.error_message)) ||
			(data &&
				(data.msg ||
					data.message ||
					data.error ||
					data.error_message)) ||
			`Banana 图像生成失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "banana_request_failed",
			details: {
				upstreamStatus: res.status,
				upstreamData: normalizedError.payload ?? data ?? null,
				upstreamRaw: normalizedError.raw ?? data ?? null,
				upstreamEvents:
					normalizedError.events && normalizedError.events.length
						? normalizedError.events
						: undefined,
			},
		});
	}

	const normalized = normalizeBananaResponse(data);
	const payload = normalized.payload ?? {};

	const imageUrls = extractBananaImageUrls(payload);
	const assets = imageUrls.map((url) =>
		TaskAssetSchema.parse({
			type: "image",
			url,
			thumbnailUrl: null,
		}),
	);

	const statusValue =
		typeof payload?.status === "string"
			? payload.status.toLowerCase()
			: undefined;
	const failureReasonRaw =
		(typeof payload?.failure_reason === "string" &&
			payload.failure_reason.trim()) ||
		(typeof payload?.error === "string" && payload.error.trim()) ||
		undefined;

	// 没有图片但上游明确标记 failed（例如 output_moderation）时，
	// 视为「任务失败」而不是 HTTP 级别错误，交由前端根据 status 处理。
	let status: TaskResult["status"];
	if (assets.length > 0) {
		status =
			statusValue === "failed" ? "failed" : "succeeded";
	} else {
		status = "failed";
	}

	const id =
		(typeof payload?.id === "string" && payload.id.trim()) ||
		`banana-${Date.now().toString(36)}`;

	return TaskResultSchema.parse({
		id,
		kind: req.kind,
		status,
		assets,
		raw: {
			provider: "gemini",
			vendor: "grsai",
			model: normalizedModel,
			response: payload ?? data,
			failureReason: failureReasonRaw,
			events:
				normalized.events && normalized.events.length
					? normalized.events
					: undefined,
			raw: normalized.raw ?? data,
		},
	});
}

// ---- Qwen 文生图（简化版） ----

async function runQwenTextToImageTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const ctx = await resolveVendorContext(c, userId, "qwen");
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 Qwen API Key", {
			status: 400,
			code: "qwen_api_key_missing",
		});
	}

	const base =
		normalizeBaseUrl(ctx.baseUrl) || "https://dashscope.aliyuncs.com";

	const model =
		pickModelKey(req, { modelKey: undefined }) || "qwen-image-plus";

	const width = req.width || 1328;
	const height = req.height || 1328;

	const body = {
		model,
		input: {
			prompt: req.prompt,
		},
		parameters: {
			size: `${width}*${height}`,
			n: 1,
			prompt_extend: true,
			watermark: true,
		},
	};

	const url = `${base.replace(
		/\/+$/,
		"",
	)}/api/v1/services/aigc/text2image/image-synthesis`;

	const data = await callJsonApi(
		url,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"X-DashScope-Async": "enable",
			},
			body: JSON.stringify(body),
		},
		{ provider: "qwen" },
	);

	const results = Array.isArray(data?.output?.results)
		? data.output.results
		: [];

	const assets = results
		.map((r: any) => {
			const urlVal =
				(typeof r?.url === "string" && r.url.trim()) ||
				(typeof r?.image_url === "string" && r.image_url.trim()) ||
				"";
			if (!urlVal) return null;
			return TaskAssetSchema.parse({
				type: "image",
				url: urlVal,
				thumbnailUrl: null,
			});
		})
		.filter(Boolean) as Array<ReturnType<typeof TaskAssetSchema.parse>>;

	const id =
		(typeof data?.request_id === "string" && data.request_id.trim()) ||
		(typeof data?.output?.task_id === "string" &&
			data.output.task_id.trim()) ||
		`qwen-img-${Date.now().toString(36)}`;

	const status: "succeeded" | "failed" =
		assets.length > 0 ? "succeeded" : "failed";

	return TaskResultSchema.parse({
		id,
		kind: "text_to_image",
		status,
		assets,
		raw: {
			provider: "qwen",
			response: data,
		},
	});
}

// ---- Anthropic 文案（仅 chat/prompt_refine） ----

async function runAnthropicTextTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const ctx = await resolveVendorContext(c, userId, "anthropic");
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 Anthropic API Key", {
			status: 400,
			code: "anthropic_api_key_missing",
		});
	}

	const base =
		normalizeBaseUrl(ctx.baseUrl) || "https://api.anthropic.com/v1";
	const model =
		pickModelKey(req, { modelKey: undefined }) ||
		"claude-3.5-sonnet-latest";

	const systemPrompt =
		req.kind === "prompt_refine"
			? pickSystemPrompt(
					req,
					"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
				)
			: pickSystemPrompt(req, "");

	const messages = [
		{
			role: "user",
			content: req.prompt,
		},
	];

	const body: any = {
		model,
		max_tokens: 4096,
		messages,
	};
	if (systemPrompt) {
		body.system = systemPrompt;
	}

	const url = /\/v\d+\/messages$/i.test(base)
		? base
		: `${base.replace(/\/+$/, "")}/messages`;

	const data = await callJsonApi(
		url,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify(body),
		},
		{ provider: "anthropic" },
	);

	const parts = Array.isArray(data?.content)
		? data.content
		: [];
	const text = parts
		.map((p: any) =>
			typeof p?.text === "string" ? p.text : "",
		)
		.join("\n")
		.trim();

	const id =
		(typeof data?.id === "string" && data.id.trim()) ||
		`anth-${Date.now().toString(36)}`;

	return TaskResultSchema.parse({
		id,
		kind: req.kind,
		status: "succeeded",
		assets: [],
		raw: {
			provider: "anthropic",
			response: data,
			text: text || "Anthropic 调用成功",
		},
	});
}

export async function runGenericTaskForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const v = vendor.toLowerCase();
	const progressCtx = extractProgressContext(req, v);

	// 所有厂商统一：/tasks 视为“创建任务”，立即发出 queued/running 事件
	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

	try {
		emitProgress(userId, progressCtx, {
			status: "running",
			progress: 5,
		});

		let result: TaskResult;

		if (v === "openai") {
			if (req.kind === "image_to_prompt") {
				result = await runOpenAiImageToPromptTask(c, userId, req);
			} else if (
				req.kind === "chat" ||
				req.kind === "prompt_refine"
			) {
				result = await runOpenAiTextTask(c, userId, req);
			} else {
				throw new AppError(
					"OpenAI 仅支持 chat/prompt_refine/image_to_prompt",
					{
						status: 400,
						code: "unsupported_task_kind",
					},
				);
			}
		} else if (v === "gemini") {
			if (req.kind === "text_to_image" || req.kind === "image_edit") {
				result = await runGeminiBananaImageTask(c, userId, req);
			} else if (
				req.kind === "chat" ||
				req.kind === "prompt_refine"
			) {
				result = await runGeminiTextTask(c, userId, req);
			} else {
				throw new AppError(
					"Gemini 目前仅在 Worker 中支持文案任务与 Banana 图像任务",
					{
						status: 400,
						code: "unsupported_task_kind",
					},
				);
			}
		} else if (v === "qwen") {
			if (req.kind === "text_to_image") {
				result = await runQwenTextToImageTask(c, userId, req);
			} else {
				throw new AppError(
					"Qwen 目前仅在 Worker 中支持 text_to_image",
					{
						status: 400,
						code: "unsupported_task_kind",
					},
				);
			}
		} else if (v === "anthropic") {
			if (req.kind === "chat" || req.kind === "prompt_refine") {
				result = await runAnthropicTextTask(c, userId, req);
			} else {
				throw new AppError(
					"Anthropic 目前仅在 Worker 中支持文案任务",
					{
						status: 400,
						code: "unsupported_task_kind",
					},
				);
			}
		} else {
			throw new AppError(`Unsupported vendor: ${vendor}`, {
				status: 400,
				code: "unsupported_vendor",
			});
		}

		const persistAssets =
			typeof (req.extras as any)?.persistAssets === "boolean"
				? (req.extras as any).persistAssets
				: true;

		if (persistAssets && result.assets && result.assets.length > 0) {
			// 将生成结果写入 assets（仅记录元数据，URL 仍使用源地址）
			const hostedAssets = await hostTaskAssetsInWorker({
				c,
				userId,
				assets: result.assets,
				meta: {
					taskKind: req.kind,
					prompt: req.prompt,
					vendor: v,
					modelKey:
						(typeof (req.extras as any)?.modelKey === "string" &&
							(req.extras as any).modelKey) ||
						undefined,
				},
			});
			result = TaskResultSchema.parse({
				...result,
				assets: hostedAssets,
			});
		}

		// 统一发出完成事件，便于前端通过 /tasks/stream 或 /tasks/pending 聚合观察
		emitProgress(userId, progressCtx, {
			status: result.status,
			progress: result.status === "succeeded" ? 100 : undefined,
			taskId: result.id,
			assets: result.assets,
			raw: result.raw,
		});

		return result;
	} catch (err: any) {
		// 失败时也发一条 failed snapshot，方便前端统一处理
		const message =
			typeof err?.message === "string"
				? err.message
				: "任务执行失败";
		emitProgress(userId, progressCtx, {
			status: "failed",
			progress: 0,
			message,
		});
		throw err;
	}
}
