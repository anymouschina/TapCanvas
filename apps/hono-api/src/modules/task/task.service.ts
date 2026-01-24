import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
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
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";

type VendorContext = {
	baseUrl: string;
	apiKey: string;
	viaProxyVendor?: string;
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

function decodeBase64ToBytes(base64: string): Uint8Array {
	const cleaned = (base64 || "").trim();
	if (!cleaned) return new Uint8Array(0);
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function detectImageExtensionFromMimeType(contentType: string): string {
	const ct = (contentType || "").toLowerCase();
	if (ct === "image/png") return "png";
	if (ct === "image/jpeg") return "jpg";
	if (ct === "image/webp") return "webp";
	if (ct === "image/gif") return "gif";
	return "bin";
}

function buildInlineAssetR2Key(userId: string, ext: string, prefix: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const date = new Date();
	const datePrefix = `${date.getUTCFullYear()}${String(
		date.getUTCMonth() + 1,
	).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	const dir = prefix ? prefix.replace(/^\/+|\/+$/g, "") : "gen";
	return `${dir}/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;
}

async function uploadInlineImageToR2(options: {
	c: AppContext;
	userId: string;
	mimeType: string;
	base64: string;
	prefix?: string;
}): Promise<string> {
	const { c, userId, mimeType, base64 } = options;
	const bucket = (c.env as any).R2_ASSETS as R2Bucket | undefined;
	if (!bucket) {
		throw new AppError("OSS storage is not configured", {
			status: 500,
			code: "oss_not_configured",
			details: { binding: "R2_ASSETS" },
		});
	}

	const ext = detectImageExtensionFromMimeType(mimeType);
	const key = buildInlineAssetR2Key(userId, ext, options.prefix || "gen/images");
	const bytes = decodeBase64ToBytes(base64);
	await bucket.put(key, bytes, {
		httpMetadata: {
			contentType: mimeType || "application/octet-stream",
		},
	});

	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	return publicBase ? `${publicBase}/${key}` : `/${key}`;
}

function normalizeVendorKey(vendor: string): string {
	const v = (vendor || "").trim().toLowerCase();
	// Backward/alias compatibility: treat "google" as Gemini.
	if (v === "google") return "gemini";
	// Alias: Hailuo is MiniMax video.
	if (v === "hailuo") return "minimax";
	return v;
}

function isGrsaiBaseUrl(url: string): boolean {
	const val = url.toLowerCase();
	// New Sora2API/GRSAI protocol uses chat/completions for image/character.
	// Treat both grsai and sora2api domains as the new protocol base.
	return val.includes("grsai") || val.includes("sora2api");
}

function expandProxyVendorKeys(vendor: string): string[] {
	const v = normalizeVendorKey(vendor);
	const keys = [v];
	// 兼容历史配置：面板里使用 "sora" 作为代理目标，但任务里使用 "sora2api"
	if (v === "sora2api") {
		keys.push("sora");
	}
	// 兼容别名：hailuo -> minimax
	if (v === "minimax") {
		keys.push("hailuo");
	}
	return Array.from(new Set(keys));
}

async function resolveProxyForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
): Promise<ProxyProviderRow | null> {
	const keys = expandProxyVendorKeys(vendor);

	// 1) Direct match on vendor (for legacy configs)
	const direct: ProxyProviderRow[] = [];
	for (const key of keys) {
		const res = await c.env.DB.prepare(
			`SELECT * FROM proxy_providers
     WHERE owner_id = ? AND vendor = ? AND enabled = 1`,
		)
			.bind(userId, key)
			.all<ProxyProviderRow>();
		if (res.results?.length) {
			direct.push(...res.results);
		}
	}

	// 2) Match via enabled_vendors JSON (recommended)
	const viaEnabled: ProxyProviderRow[] = [];
	for (const key of keys) {
		const res = await c.env.DB.prepare(
			`SELECT * FROM proxy_providers
     WHERE owner_id = ? AND enabled = 1
       AND enabled_vendors IS NOT NULL
       AND enabled_vendors LIKE ?`,
		)
			.bind(userId, `%"${key}"%`)
			.all<ProxyProviderRow>();
		if (res.results?.length) {
			viaEnabled.push(...res.results);
		}
	}

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

	const parseEpoch = (iso?: string | null) => {
		if (!iso || typeof iso !== "string") return 0;
		const t = Date.parse(iso);
		return Number.isFinite(t) ? t : 0;
	};

	// Prefer the most recently updated proxy config to make vendor switching predictable
	return [...all].sort((a, b) => {
		const bt = parseEpoch(b.updated_at) || parseEpoch(b.created_at);
		const at = parseEpoch(a.updated_at) || parseEpoch(a.created_at);
		return bt - at;
	})[0]!;
}

export async function resolveVendorContext(
	c: AppContext,
	userId: string,
	vendor: string,
): Promise<VendorContext> {
	const v = normalizeVendorKey(vendor);

	// 1) Try user-level proxy config (proxy_providers + enabled_vendors)
	const proxy = await resolveProxyForVendor(c, userId, v);
	const hasUserProxy = !!(proxy && proxy.enabled === 1);

	if (proxy && proxy.enabled === 1) {
		const baseUrl = normalizeBaseUrl(proxy.base_url);
		const apiKey = (proxy.api_key || "").trim();
		if (!baseUrl || !apiKey) {
			throw new AppError("Proxy for vendor is misconfigured", {
				status: 400,
				code: "proxy_misconfigured",
			});
		}
		return { baseUrl, apiKey, viaProxyVendor: proxy.vendor };
	}

	// 2) Fallback to model_providers + model_tokens（含跨用户共享 Token）
	const providers = await c.env.DB.prepare(
		`SELECT * FROM model_providers WHERE owner_id = ? AND vendor = ? ORDER BY created_at ASC`,
	)
		.bind(userId, v)
		.all<ProviderRow>()
		.then((r) => r.results || []);

	let provider: ProviderRow | null = providers[0] ?? null;
	let sharedTokenProvider: ProviderRow | null = null;
	let apiKey = "";

	const envAny = c.env as any;
	const envSora2ApiKey =
		(v === "sora2api" || v === "grsai") &&
		typeof envAny.SORA2API_API_KEY === "string" &&
		envAny.SORA2API_API_KEY.trim()
			? (envAny.SORA2API_API_KEY as string).trim()
			: "";
	const resolveEnvSora2Base = () =>
		(typeof envAny.SORA2API_BASE_URL === "string" && envAny.SORA2API_BASE_URL) ||
		(typeof envAny.SORA2API_BASE === "string" && envAny.SORA2API_BASE) ||
		"http://localhost:8000";
	const envSora2Base = normalizeBaseUrl(resolveEnvSora2Base());
	const envSora2BaseIsLocal =
		!!envSora2Base &&
		/^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(envSora2Base);
	let userConfigured = hasUserProxy;
	let preferEnvSora2Base = false;

	if (requiresApiKeyForVendor(v)) {
		let token: TokenRow | null = null;

		// 2.1 优先使用当前用户在该 Provider 下的 Token（自己配置优先）
		if (provider) {
			const ownedRows = await c.env.DB.prepare(
				`SELECT * FROM model_tokens
         WHERE provider_id = ? AND user_id = ? AND enabled = 1
         ORDER BY created_at ASC LIMIT 1`,
			)
				.bind(provider.id, userId)
				.all<TokenRow>();
			token = (ownedRows.results || [])[0] ?? null;

			// 2.2 若没有自己的 Token，尝试该 Provider 下的共享 Token
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

			if (token && typeof token.secret_token === "string") {
				apiKey = token.secret_token.trim();
				userConfigured = true;
			}
		}

		// 2.3 对于 sora2api/grsai，只有当用户没有任何 Token/Proxy 配置时才允许使用 Env 级别兜底
		if (!apiKey && envSora2ApiKey && !userConfigured) {
			apiKey = envSora2ApiKey;
			preferEnvSora2Base = true;
		}

		// 2.4 仍未拿到，则从任意用户的共享 Token 中为该 vendor 选择一个（全局共享池）
		if (!apiKey && !userConfigured) {
			const shared = await findSharedTokenForVendor(c, v);
			if (shared && typeof shared.token.secret_token === "string") {
				apiKey = shared.token.secret_token.trim();
				sharedTokenProvider = shared.provider;
				userConfigured = true;
			}
		}

		if (!apiKey) {
			throw new AppError(`No API key configured for vendor ${v}`, {
				status: 400,
				code: "api_key_missing",
			});
		}
	}

	// 2.5 若用户自己没有 Provider，但通过共享 Token 找到了 Provider，则使用该 Provider
	if (!provider && sharedTokenProvider) {
		provider = sharedTokenProvider;
	}

	// 2.6 provider 仍不存在时，对于 sora2api/grsai 允许完全依赖 Env 级别配置；其他 vendor 报错
	if (!provider) {
		if ((v === "sora2api" || v === "grsai") && envSora2ApiKey && !userConfigured) {
			const baseUrl = normalizeBaseUrl(resolveEnvSora2Base());
			if (!baseUrl) {
				throw new AppError(`No base URL configured for vendor ${v}`, {
					status: 400,
					code: "base_url_missing",
				});
			}
			return { baseUrl, apiKey: envSora2ApiKey || apiKey };
		}

		throw new AppError(`No provider configured for vendor ${v}`, {
			status: 400,
			code: "provider_not_configured",
		});
	}

	// 2.7 解析 baseUrl：优先 Provider.base_url，其次 shared_base_url，全局默认
	let baseUrl = normalizeBaseUrl(
		preferEnvSora2Base
			? ""
			: provider.base_url || (await resolveSharedBaseUrl(c, v)) || "",
	);

	if (!baseUrl) {
		if (v === "veo") {
			baseUrl = normalizeBaseUrl("https://api.grsai.com");
		} else if (v === "sora2api" || v === "grsai") {
			baseUrl = envSora2Base;
		}
	}

	// Dev-friendly override: when SORA2API_BASE_URL points to localhost,
	// prefer it over a non-local provider/proxy base to avoid self-recursion.
	if (v === "sora2api" && envSora2BaseIsLocal && envSora2Base && envSora2Base !== baseUrl) {
		baseUrl = envSora2Base;
	}

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

type SharedTokenWithProvider = {
	token: TokenRow;
	provider: ProviderRow;
};

async function findSharedTokenForVendor(
	c: AppContext,
	vendor: string,
): Promise<SharedTokenWithProvider | null> {
	const nowIso = new Date().toISOString();
	const row = await c.env.DB.prepare(
		`SELECT
       t.id,
       t.provider_id,
       t.label,
       t.secret_token,
       t.user_agent,
       t.user_id,
       t.enabled,
       t.shared,
       t.shared_failure_count,
       t.shared_last_failure_at,
       t.shared_disabled_until,
       t.created_at,
       t.updated_at,
       p.id   AS p_id,
       p.name AS p_name,
       p.vendor AS p_vendor,
       p.base_url AS p_base_url,
       p.shared_base_url AS p_shared_base_url,
       p.owner_id AS p_owner_id,
       p.created_at AS p_created_at,
       p.updated_at AS p_updated_at
     FROM model_tokens t
     JOIN model_providers p ON p.id = t.provider_id
     WHERE t.shared = 1
       AND t.enabled = 1
       AND p.vendor = ?
       AND (t.shared_disabled_until IS NULL OR t.shared_disabled_until < ?)
     ORDER BY t.updated_at ASC
     LIMIT 1`,
	)
		.bind(vendor, nowIso)
		.first<any>();

	if (!row) return null;

	const token: TokenRow = {
		id: row.id,
		provider_id: row.provider_id,
		label: row.label,
		secret_token: row.secret_token,
		user_agent: row.user_agent,
		user_id: row.user_id,
		enabled: row.enabled,
		shared: row.shared,
		shared_failure_count: row.shared_failure_count,
		shared_last_failure_at: row.shared_last_failure_at,
		shared_disabled_until: row.shared_disabled_until,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};

	const provider: ProviderRow = {
		id: row.p_id,
		name: row.p_name,
		vendor: row.p_vendor,
		base_url: row.p_base_url,
		shared_base_url: row.p_shared_base_url,
		owner_id: row.p_owner_id,
		created_at: row.p_created_at,
		updated_at: row.p_updated_at,
	};

	return { token, provider };
}

function requiresApiKeyForVendor(vendor: string): boolean {
	const v = normalizeVendorKey(vendor);
	return (
		v === "gemini" ||
		v === "qwen" ||
		v === "anthropic" ||
		v === "openai" ||
		v === "veo" ||
		v === "sora2api" ||
		v === "grsai" ||
		v === "minimax"
	);
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

type ComflyGenerationStatus =
	| "NOT_START"
	| "SUBMITTED"
	| "QUEUED"
	| "IN_PROGRESS"
	| "SUCCESS"
	| "FAILURE";

function normalizeComflyStatus(value: unknown): ComflyGenerationStatus | null {
	if (typeof value !== "string") return null;
	const upper = value.trim().toUpperCase();
	if (
		upper === "NOT_START" ||
		upper === "SUBMITTED" ||
		upper === "QUEUED" ||
		upper === "IN_PROGRESS" ||
		upper === "SUCCESS" ||
		upper === "FAILURE"
	) {
		return upper as ComflyGenerationStatus;
	}
	return null;
}

function mapComflyStatusToTaskStatus(status: ComflyGenerationStatus | null): TaskStatus {
	if (status === "SUCCESS") return "succeeded";
	if (status === "FAILURE") return "failed";
	if (status === "IN_PROGRESS") return "running";
	return "queued";
}

function parseComflyProgress(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return clampProgress(value);
	}
	if (typeof value !== "string") return undefined;
	const raw = value.trim();
	if (!raw) return undefined;
	const percentMatch = raw.match(/^(\d+(?:\.\d+)?)\s*%$/);
	if (percentMatch) {
		const num = Number(percentMatch[1]);
		return clampProgress(Number.isFinite(num) ? num : undefined);
	}
	const num = Number(raw);
	return clampProgress(Number.isFinite(num) ? num : undefined);
}

	function extractComflyOutputUrls(payload: any): string[] {
		const urls: string[] = [];
		const add = (v: any) => {
			if (typeof v === "string" && v.trim()) urls.push(v.trim());
		};
	if (payload?.data) {
		const data = payload.data;
		if (Array.isArray(data?.outputs)) {
			data.outputs.forEach(add);
		}
		add(data?.output);
	}
	if (Array.isArray(payload?.outputs)) {
		payload.outputs.forEach(add);
	}
	add(payload?.output);
		return Array.from(new Set(urls));
	}

	function normalizeSora2OfficialStatus(value: unknown): TaskStatus | null {
		if (typeof value !== "string") return null;
		const normalized = value.trim().toLowerCase();
		if (!normalized) return null;
		if (normalized === "completed" || normalized === "succeeded" || normalized === "success") {
			return "succeeded";
		}
		if (normalized === "failed" || normalized === "failure" || normalized === "error") {
			return "failed";
		}
		if (normalized === "queued" || normalized === "in_progress" || normalized === "running" || normalized === "processing") {
			return "running";
		}
		return null;
	}

	function extractSora2OfficialVideoUrl(payload: any): string | null {
		const pick = (v: any): string | null =>
			typeof v === "string" && v.trim() ? v.trim() : null;
		const fromObjectUrl = (v: any): string | null => {
			if (!v || typeof v !== "object") return null;
			return pick((v as any).url) || null;
		};
		return (
			pick(payload?.video_url) ||
			fromObjectUrl(payload?.video_url) ||
			pick(payload?.videoUrl) ||
			fromObjectUrl(payload?.videoUrl) ||
			pick(payload?.url) ||
			pick(payload?.data?.video_url) ||
			pick(payload?.data?.url) ||
			(Array.isArray(payload?.results) && payload.results.length
				? pick(payload.results[0]?.url) ||
					pick(payload.results[0]?.video_url) ||
					pick(payload.results[0]?.videoUrl)
				: null) ||
			null
		);
	}

	function normalizeComflyGeminiModelId(modelKey?: string | null): string {
		const trimmed = (modelKey || "").trim();
		if (!trimmed) return "gemini-3-pro-image-preview";
		const bare = trimmed.startsWith("models/") ? trimmed.slice(7) : trimmed;
		if (/^nano-banana-pro/i.test(bare)) return "gemini-3-pro-image-preview";
		if (/^nano-banana/i.test(bare)) return "gemini-3-pro-image-preview";
		return bare;
	}

	async function createComflyVideoTask(
		c: AppContext,
		userId: string,
		req: TaskRequestDto,
	ctx: VendorContext,
	model: string,
	input: {
		aspectRatio?: string | null;
		duration?: number | string | null;
		images?: string[];
		videos?: string[];
		hd?: boolean | null;
		notifyHook?: string | null;
		private?: boolean | null;
		watermark?: boolean | null;
		resolution?: string | null;
		size?: string | null;
	},
	progressCtx: ProgressContext | null,
): Promise<TaskResult> {
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = ctx.apiKey.trim();
	if (!baseUrl || !apiKey) {
		throw new AppError("comfly 代理未配置 Host 或 API Key", {
			status: 400,
			code: "comfly_proxy_misconfigured",
		});
	}

	const body: Record<string, any> = {
		prompt: req.prompt,
		model,
	};
	if (typeof input.duration === "number" && Number.isFinite(input.duration)) {
		body.duration = input.duration;
	} else if (typeof input.duration === "string" && input.duration.trim()) {
		body.duration = input.duration.trim();
	}
	if (typeof input.aspectRatio === "string" && input.aspectRatio.trim()) {
		body.aspect_ratio = input.aspectRatio.trim();
	}
	if (typeof input.hd === "boolean") {
		body.hd = input.hd;
	}
	if (typeof input.notifyHook === "string" && input.notifyHook.trim()) {
		body.notify_hook = input.notifyHook.trim();
	}
	if (typeof input.private === "boolean") {
		body.private = input.private;
	}
	if (typeof input.size === "string" && input.size.trim()) {
		body.size = input.size.trim();
	}
	if (typeof input.resolution === "string" && input.resolution.trim()) {
		body.resolution = input.resolution.trim();
	}
	if (typeof input.watermark === "boolean") {
		body.watermark = input.watermark;
	}
	if (Array.isArray(input.images) && input.images.length) {
		body.images = input.images;
	}
	if (Array.isArray(input.videos) && input.videos.length) {
		body.videos = input.videos;
	}

	let res: Response;
	let data: any = null;
	try {
		emitProgress(userId, progressCtx, { status: "running", progress: 5 });
		res = await fetchWithHttpDebugLog(
			c,
			`${baseUrl}/v2/videos/generations`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ tag: "comfly:videos:create" },
		);
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("comfly 视频任务创建失败", {
			status: 502,
			code: "comfly_request_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error || data.msg)) ||
			`comfly 视频任务创建失败：${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "comfly_request_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const taskId =
		typeof data?.task_id === "string" && data.task_id.trim()
			? data.task_id.trim()
			: null;
	if (!taskId) {
		throw new AppError("comfly API 未返回 task_id", {
			status: 502,
			code: "comfly_task_id_missing",
			details: { upstreamData: data ?? null },
		});
	}

	emitProgress(userId, progressCtx, {
		status: "running",
		progress: 10,
		taskId,
		raw: data ?? null,
	});

	return TaskResultSchema.parse({
		id: taskId,
		kind: req.kind,
		status: "running",
		assets: [],
		raw: {
			provider: "comfly",
			model,
			taskId,
			response: data ?? null,
			},
		});
	}

	async function createComflySora2VideoTask(
		c: AppContext,
		userId: string,
		req: TaskRequestDto,
		ctx: VendorContext,
		input: {
			model: string;
			size?: string | null;
			seconds?: number | null;
			watermark?: boolean | null;
			inputReferenceUrl?: string | null;
		},
		progressCtx: ProgressContext | null,
	): Promise<TaskResult> {
		const model = (input.model || "").trim() || "sora-2";
		const isProModel = model.toLowerCase() === "sora-2-pro";
		const extras = (req.extras || {}) as Record<string, any>;

		const aspectRatio = (() => {
			const fromExtras =
				(typeof extras.aspect_ratio === "string" &&
					extras.aspect_ratio.trim()) ||
				(typeof extras.aspectRatio === "string" &&
					extras.aspectRatio.trim()) ||
				"";
			if (fromExtras === "16:9" || fromExtras === "9:16") {
				return fromExtras;
			}
			const raw = typeof input.size === "string" ? input.size.trim() : "";
			if (!raw) return null;
			const match = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
			if (!match) return null;
			const width = Number(match[1]);
			const height = Number(match[2]);
			if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
			return width >= height ? "16:9" : "9:16";
		})();

		const duration = (() => {
			const seconds =
				typeof input.seconds === "number" && Number.isFinite(input.seconds)
					? Math.max(1, Math.floor(input.seconds))
					: 10;
			if (seconds <= 10) return "10";
			if (seconds <= 15) return "15";
			return isProModel ? "25" : "15";
		})();

		const images = (() => {
			const urls: string[] = [];
			const add = (v: any) => {
				if (typeof v === "string" && v.trim()) urls.push(v.trim());
			};
			if (Array.isArray(extras.images)) extras.images.forEach(add);
			if (Array.isArray(extras.urls)) extras.urls.forEach(add);
			add(extras.url);
			add(extras.firstFrameUrl);
			add(input.inputReferenceUrl);
			const deduped = Array.from(new Set(urls));
			return deduped.length ? deduped.slice(0, 8) : undefined;
		})();
		const hd =
			isProModel && typeof extras.hd === "boolean" ? extras.hd : null;
		const notifyHook =
			(typeof extras.notify_hook === "string" &&
				extras.notify_hook.trim()) ||
			(typeof extras.notifyHook === "string" && extras.notifyHook.trim()) ||
			null;
		const isPrivate =
			typeof extras.private === "boolean"
				? extras.private
				: typeof extras.isPrivate === "boolean"
					? extras.isPrivate
					: null;

		return createComflyVideoTask(
			c,
			userId,
			req,
			ctx,
			model,
			{
				aspectRatio,
				duration,
				images,
				hd,
				notifyHook,
				private: isPrivate,
				watermark: input.watermark ?? null,
			},
			progressCtx,
		);
	}

	async function fetchComflySora2VideoTaskResult(
		c: AppContext,
		userId: string,
		taskId: string,
		ctx: VendorContext,
		kind: TaskRequestDto["kind"],
	) {
		return fetchComflyVideoTaskResult(c, userId, taskId, ctx, kind, {
			metaVendor: "sora2api",
			throwOnFailed: false,
		});
	}

	async function fetchComflyVideoTaskResult(
		c: AppContext,
		userId: string,
		taskId: string,
	ctx: VendorContext,
	kind: TaskRequestDto["kind"],
	options?: { metaVendor?: string; throwOnFailed?: boolean },
) {
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = ctx.apiKey.trim();
	if (!baseUrl || !apiKey) {
		throw new AppError("comfly 代理未配置 Host 或 API Key", {
			status: 400,
			code: "comfly_proxy_misconfigured",
		});
	}

	let res: Response;
	let data: any = null;
	try {
		res = await fetchWithHttpDebugLog(
			c,
			`${baseUrl}/v2/videos/generations/${encodeURIComponent(taskId.trim())}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			},
			{ tag: "comfly:videos:result" },
		);
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("comfly 结果查询失败", {
			status: 502,
			code: "comfly_result_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error || data.msg)) ||
			`comfly result poll failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "comfly_result_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

		const status = normalizeComflyStatus(data?.status);
		const mappedStatus = mapComflyStatusToTaskStatus(status);
		const progress = parseComflyProgress(data?.progress);
		const metaVendor =
			typeof options?.metaVendor === "string" && options.metaVendor.trim()
				? options.metaVendor.trim()
				: "veo";
		const throwOnFailed = options?.throwOnFailed !== false;

		if (mappedStatus === "failed") {
			const reason =
				(typeof data?.fail_reason === "string" && data.fail_reason.trim()) ||
				(typeof data?.message === "string" && data.message.trim()) ||
				"comfly 视频任务失败";
			if (!throwOnFailed) {
				return TaskResultSchema.parse({
					id: taskId,
					kind,
					status: "failed",
					assets: [],
					raw: {
						provider: "comfly",
						vendor: metaVendor,
						response: data ?? null,
						progress,
						error: reason,
						message: reason,
					},
				});
			}
			throw new AppError(reason, {
				status: 502,
				code: "comfly_result_failed",
				details: { upstreamData: data ?? null },
			});
		}

		if (mappedStatus !== "succeeded") {
			return TaskResultSchema.parse({
				id: taskId,
				kind,
				status: mappedStatus === "queued" ? "running" : mappedStatus,
				assets: [],
				raw: {
					provider: "comfly",
					vendor: metaVendor,
					response: data ?? null,
					progress,
				},
			});
		}

	const urls = extractComflyOutputUrls(data);
	if (!urls.length) {
		return TaskResultSchema.parse({
			id: taskId,
			kind,
			status: "running",
			assets: [],
			raw: {
				provider: "comfly",
				response: data ?? null,
				progress,
			},
		});
	}

	const assets = urls.map((url) =>
		TaskAssetSchema.parse({ type: "video", url, thumbnailUrl: null }),
	);

		const hostedAssets = await hostTaskAssetsInWorker({
			c,
			userId,
			assets,
			meta: {
				taskKind: kind,
				prompt:
					typeof (data as any)?.prompt === "string"
						? (data as any).prompt
						: null,
				vendor: metaVendor,
				modelKey:
					typeof (data as any)?.model === "string"
						? (data as any).model
						: undefined,
				taskId:
				(typeof (data as any)?.task_id === "string" &&
					(data as any).task_id) ||
				taskId,
		},
	});

		return TaskResultSchema.parse({
			id:
				(typeof (data as any)?.task_id === "string" &&
					(data as any).task_id) ||
				taskId,
			kind,
			status: "succeeded",
			assets: hostedAssets,
			raw: {
				provider: "comfly",
				vendor: metaVendor,
				response: data ?? null,
			},
		});
	}

	export async function runVeoVideoTask(
		c: AppContext,
		userId: string,
		req: TaskRequestDto,
	): Promise<TaskResult> {
		const progressCtx = extractProgressContext(req, "veo");
		emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

		const extras = (req.extras || {}) as Record<string, any>;
		const model = normalizeVeoModelKey(
			(typeof extras.modelKey === "string" && extras.modelKey) ||
				(req.extras && (req.extras as any).modelKey) ||
				null,
		);

		// New: Veo models can be served via sora2api's OpenAI-compatible chat endpoint (model ids are veo_*)
		if (/^veo_/i.test(model)) {
			return runSora2ApiChatCompletionsVideoTask(c, userId, req, {
				model,
				progressVendor: "veo",
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

		if (ctx.viaProxyVendor === "comfly") {
			const images = (() => {
				if (firstFrameUrl) {
					const out = [firstFrameUrl];
					if (lastFrameUrl) out.push(lastFrameUrl);
					return out;
				}
				return referenceImages;
			})();
			return createComflyVideoTask(
				c,
				userId,
				req,
				ctx,
				model,
				{
					aspectRatio,
					images: images.length ? images : undefined,
				},
				progressCtx,
			);
		}

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
		res = await fetchWithHttpDebugLog(
			c,
			`${baseUrl}/v1/video/veo`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ tag: "veo:create" },
		);
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
	if (ctx.viaProxyVendor === "comfly") {
		return fetchComflyVideoTaskResult(
			c,
			userId,
			taskId,
			ctx,
			"text_to_video",
		);
	}
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
		res = await fetchWithHttpDebugLog(
			c,
			`${baseUrl}/v1/draw/result`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ id: taskId.trim() }),
			},
			{ tag: "veo:result" },
		);
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
				prompt:
					typeof payload.prompt === "string"
						? payload.prompt
						: null,
				vendor: "veo",
				modelKey:
					typeof payload.model === "string"
						? payload.model
						: undefined,
				taskId: (payload.id || taskId) ?? null,
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
	const isGrsaiBase =
		isGrsaiBaseUrl(baseUrl) || ctx.viaProxyVendor === "grsai";
	const isComflyProxy = ctx.viaProxyVendor === "comfly";
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

	const modelKeyRaw =
		typeof extras.modelKey === "string" && extras.modelKey.trim()
			? extras.modelKey.trim()
			: "";
	const model = isComflyProxy
		? modelKeyRaw || "sora-2"
		: isGrsaiBase
			? modelKeyRaw || "sora-2"
			: normalizeSora2ApiModelKey(modelKeyRaw || undefined, orientation, durationSeconds);
	const aspectRatio = orientation === "portrait" ? "9:16" : "16:9";
	const webHook =
		typeof extras.webHook === "string" && extras.webHook.trim()
			? extras.webHook.trim()
			: "-1";
	const shutProgress = extras.shutProgress === true;
	const remixTargetId =
		(typeof extras.remixTargetId === "string" &&
			extras.remixTargetId.trim()) ||
		(typeof extras.pid === "string" && extras.pid.trim()) ||
		null;
	const size =
		typeof extras.size === "string" && extras.size.trim()
			? extras.size.trim()
			: "small";
	const characters = Array.isArray(extras.characters)
		? extras.characters
		: undefined;
	const referenceUrl =
		(typeof extras.url === "string" && extras.url.trim()) ||
		(typeof extras.firstFrameUrl === "string" &&
			extras.firstFrameUrl.trim()) ||
		(Array.isArray(extras.urls) && extras.urls[0]
			? String(extras.urls[0]).trim()
			: null) ||
		null;

	if (isComflyProxy) {
		const sizeFromExtras =
			typeof extras.size === "string" && /^\d+\s*x\s*\d+$/i.test(extras.size.trim())
				? extras.size.trim().replace(/\s+/g, "")
				: null;
		const size = sizeFromExtras || (orientation === "portrait" ? "720x1280" : "1280x720");
		const watermark =
			typeof extras.watermark === "boolean" ? extras.watermark : null;
		return createComflySora2VideoTask(
			c,
			userId,
			req,
			ctx,
			{
				model,
				size,
				seconds: durationSeconds,
				watermark,
				inputReferenceUrl: referenceUrl,
			},
			progressCtx,
		);
	}

	const body: Record<string, any> = isGrsaiBase
		? {
				// grsai / Sora 协议（与 sora2/sora2api 一致）
				model,
				prompt: req.prompt,
				aspectRatio,
				aspect_ratio: aspectRatio,
				orientation,
				duration: durationSeconds,
				webHook,
				shutProgress,
				size,
				// 兼容不同实现：有的服务端使用 remixTargetId，有的使用 pid
				...(remixTargetId ? { remixTargetId, pid: remixTargetId } : {}),
				...(characters ? { characters } : {}),
				...(referenceUrl ? { url: referenceUrl } : {}),
			}
		: {
				// 兼容 sora2api 号池协议
				model,
				prompt: req.prompt,
				durationSeconds,
				orientation,
				duration: durationSeconds,
				aspectRatio,
				aspect_ratio: aspectRatio,
				webHook,
				shutProgress,
				size,
				// 兼容不同实现：有的服务端使用 remixTargetId，有的使用 pid
				...(remixTargetId ? { remixTargetId, pid: remixTargetId } : {}),
				...(characters ? { characters } : {}),
				...(referenceUrl ? { url: referenceUrl } : {}),
			};

	const creationEndpoints = (() => {
		// sora2api 创建任务应优先走 /v1/video/sora-video；当后端不是 grsai/sora2api 域时，仍尝试该路径，再回退 /v1/video/tasks。
		const soraVideoCandidates = [
			`${baseUrl}/v1/video/sora-video`,
			`${baseUrl}/v1/video/sora`,
			`${baseUrl}/client/v1/video/sora-video`,
			`${baseUrl}/client/v1/video/sora`,
			`${baseUrl}/client/video/sora-video`,
			`${baseUrl}/client/video/sora`,
		];
		const legacyTasks = [
			`${baseUrl}/v1/video/tasks`,
			`${baseUrl}/client/v1/video/tasks`,
			`${baseUrl}/client/video/tasks`,
		];
		const seen = new Set<string>();
		const dedupe = (arr: string[]) =>
			arr.filter((url) => {
				if (seen.has(url)) return false;
				seen.add(url);
				return true;
			});

		if (isGrsaiBase) {
			return dedupe(soraVideoCandidates);
		}

		return dedupe([...soraVideoCandidates, ...legacyTasks]);
	})();

	let createdTaskId: string | null = null;
	let createdPayload: any = null;
	let creationStatus: "running" | "succeeded" | "failed" = "running";
	let creationProgress: number | undefined;
	const attemptedEndpoints: Array<{ url: string; status?: number | null }> =
		[];
	let lastError: {
		status: number;
		data: any;
		message: string;
		endpoint?: string;
		requestBody?: any;
	} | null = null;

	emitProgress(userId, progressCtx, { status: "running", progress: 5 });

	for (const endpoint of creationEndpoints) {
		let res: Response;
		let data: any = null;
		try {
			res = await fetchWithHttpDebugLog(
				c,
				endpoint,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(body),
				},
				{ tag: "sora2api:createVideo" },
			);
			try {
				data = await res.json();
			} catch {
				data = null;
			}
			attemptedEndpoints.push({ url: endpoint, status: res.status });
		} catch (error: any) {
			lastError = {
				status: 502,
				data: null,
				message: error?.message ?? String(error),
				endpoint,
				requestBody: body,
			};
			attemptedEndpoints.push({ url: endpoint, status: null });
			continue;
		}

		if (res.status < 200 || res.status >= 300) {
			const upstreamMessage =
				(data &&
					(data.error?.message || data.message || data.error)) ||
				`sora2api 调用失败: ${res.status} (${endpoint})`;
			const notFoundHint =
				res.status === 404
					? `；请确认 SORA2API_BASE_URL=${baseUrl} 指向实际的视频任务服务，且存在 /v1/video/sora（或 /v1/video/sora-video）/ /v1/video/tasks 路由`
					: "";
			lastError = {
				status: res.status,
				data,
				message: `${upstreamMessage}${notFoundHint}`,
				endpoint,
				requestBody: body,
			};
			continue;
		}

		const payload =
			typeof data?.code === "number" && data.code === 0 && data.data
				? data.data
				: data;
		if (typeof data?.code === "number" && data.code !== 0) {
			lastError = {
				status: res.status,
				data,
				message:
					data?.msg ||
					data?.message ||
					data?.error ||
					`sora2api 调用失败: code ${data.code}`,
				endpoint,
				requestBody: body,
			};
			break;
		}
		const id =
			(typeof payload?.id === "string" && payload.id.trim()) ||
			(typeof payload?.taskId === "string" && payload.taskId.trim()) ||
			null;
		if (!id) {
			lastError = {
				status: 502,
				data,
				message: "sora2api 未返回任务 ID",
				endpoint,
			};
			continue;
		}

		createdTaskId = id.trim();
		createdPayload = payload;
		creationStatus = mapTaskStatus(payload?.status || "queued");
		creationProgress = clampProgress(
			typeof payload?.progress === "number"
				? payload.progress
				: typeof payload?.progress_pct === "number"
					? payload.progress_pct * 100
					: undefined,
		);
		break;
	}

	if (!createdTaskId) {
		const attemptedReadable = attemptedEndpoints.map((e) =>
			`${e.status ?? "error"} ${e.url}`,
		);
		throw new AppError(lastError?.message || "sora2api 调用失败", {
			status: lastError?.status ?? 502,
			code: "sora2api_request_failed",
			details: {
				upstreamStatus: lastError?.status ?? null,
				upstreamData: lastError?.data ?? null,
				endpointTried: lastError?.endpoint ?? null,
				attemptedEndpoints,
				attemptedEndpointsText: attemptedReadable,
				requestBody: body,
			},
		});
	}

	return TaskResultSchema.parse({
		id: createdTaskId,
		kind: "text_to_video",
		status: creationStatus,
		taskId: createdTaskId,
		assets: [],
		raw: {
			provider: "sora2api",
			model,
			taskId: createdTaskId,
			status: creationStatus,
			progress: creationProgress ?? null,
			response: createdPayload,
		},
	});
}

export async function fetchSora2ApiTaskResult(
	c: AppContext,
	userId: string,
	taskId: string,
	promptFromClient?: string | null,
) {
	if (!taskId || !taskId.trim()) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "task_id_required",
		});
	}
	const ctx = await resolveVendorContext(c, userId, "sora2api");
	if (ctx.viaProxyVendor === "comfly") {
		return fetchComflySora2VideoTaskResult(
			c,
			userId,
			taskId,
			ctx,
			"text_to_video",
		);
	}
	const baseUrl =
		normalizeBaseUrl(ctx.baseUrl) || "http://localhost:8000";
	const isGrsaiBase =
		isGrsaiBaseUrl(baseUrl) || ctx.viaProxyVendor === "grsai";
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 sora2api API Key", {
			status: 400,
			code: "sora2api_api_key_missing",
		});
	}

	const endpoints: Array<{
		url: string;
		method: "GET" | "POST";
		body?: any;
	}> = isGrsaiBase
		? [
				{
					url: `${baseUrl}/v1/draw/result`,
					method: "POST",
					body: JSON.stringify({ id: taskId.trim() }),
				},
				{
					url: `${baseUrl}/v1/video/tasks/${encodeURIComponent(
						taskId.trim(),
					)}`,
					method: "GET",
				},
			]
		: [
				{
					url: `${baseUrl}/v1/video/tasks/${encodeURIComponent(
						taskId.trim(),
					)}`,
					method: "GET",
				},
			];

	let lastError: {
		status: number;
		data: any;
		message: string;
		endpoint?: string;
	} | null = null;
	let data: any = null;

	for (const endpoint of endpoints) {
		let res: Response;
		data = null;
		try {
			res = await fetchWithHttpDebugLog(
				c,
				endpoint.url,
				{
					method: endpoint.method,
					headers: {
						Authorization: `Bearer ${apiKey}`,
						...(endpoint.method === "POST"
							? { "Content-Type": "application/json" }
							: {}),
					},
					body: endpoint.body,
				},
				{ tag: "sora2api:result" },
			);
			try {
				data = await res.json();
			} catch {
				data = null;
			}
		} catch (error: any) {
			lastError = {
				status: 502,
				data: null,
				message: error?.message ?? String(error),
				endpoint: endpoint.url,
			};
			continue;
		}

		if (res.status < 200 || res.status >= 300) {
			lastError = {
				status: res.status,
				data,
				message:
					(data &&
						(data.error?.message ||
							data.message ||
							data.error)) ||
					`sora2api 任务查询失败: ${res.status}`,
				endpoint: endpoint.url,
			};
			continue;
		}

		const payload = extractVeoResultPayload(data) ?? data ?? {};
		// 部分 sora2api 实现会把 pid/postId 放在最外层，而结果在 data 字段里；这里做一次兼容合并，避免前端拿不到 pid 导致 Remix 无法引用。
		const mergedPayload = (() => {
			if (!payload || typeof payload !== "object") return payload;
			if (!data || typeof data !== "object") return payload;
			// When extractVeoResultPayload unwraps `data`, preserve wrapper-level pid/postId.
			const wrapper = data as any;
			const current = payload as any;
			const existingPid =
				(typeof current.pid === "string" && current.pid.trim()) ||
				(typeof current.postId === "string" && current.postId.trim()) ||
				(typeof current.post_id === "string" && current.post_id.trim()) ||
				null;
			const wrapperPid =
				(typeof wrapper.pid === "string" && wrapper.pid.trim()) ||
				(typeof wrapper.postId === "string" && wrapper.postId.trim()) ||
				(typeof wrapper.post_id === "string" && wrapper.post_id.trim()) ||
				null;
			const resultEntry =
				Array.isArray(current.results) && current.results.length
					? current.results[0]
					: null;
			const resultPid =
				(resultEntry &&
					typeof resultEntry.pid === "string" &&
					resultEntry.pid.trim()) ||
				(resultEntry &&
					typeof resultEntry.postId === "string" &&
					resultEntry.postId.trim()) ||
				(resultEntry &&
					typeof resultEntry.post_id === "string" &&
					resultEntry.post_id.trim()) ||
				null;

			let merged = current;
			if (!existingPid && wrapperPid) {
				merged = { ...merged, pid: wrapperPid };
			}
			if (!existingPid && !wrapperPid && resultPid) {
				merged = { ...merged, pid: resultPid };
			}
			return merged;
		})();
		const status = mapTaskStatus(payload.status || data?.status);
		const progress = clampProgress(
			typeof payload.progress === "number"
				? payload.progress
				: typeof payload.progress_pct === "number"
					? payload.progress_pct * 100
					: undefined,
		);

		let assetPayload: any = undefined;
		let promptForAsset: string | null =
			typeof promptFromClient === "string" &&
			promptFromClient.trim()
				? promptFromClient.trim()
				: null;

		if (status === "succeeded") {
			const extractVideoUrl = (value: any): string | null => {
				if (typeof value === "string" && value.trim()) return value.trim();
				if (!value || typeof value !== "object") return null;
				const url =
					typeof (value as any).url === "string" && (value as any).url.trim()
						? String((value as any).url).trim()
						: null;
				return url;
			};

			// 优先从 results 数组解析视频
			const resultEntry =
				Array.isArray(payload.results) && payload.results.length
					? payload.results[0]
					: null;
			const resultUrl =
				(typeof resultEntry?.url === "string" &&
					resultEntry.url.trim()) ||
				null;
			const resultThumb =
				(typeof resultEntry?.thumbnailUrl === "string" &&
					resultEntry.thumbnailUrl.trim()) ||
				(typeof resultEntry?.thumbnail_url === "string" &&
					resultEntry.thumbnail_url.trim()) ||
				null;

			const directVideo =
				extractVideoUrl((payload as any).video_url) ||
				extractVideoUrl((payload as any).videoUrl) ||
				resultUrl ||
				null;
			let videoUrl: string | null = directVideo;

			if (!videoUrl && typeof payload.content === "string") {
				const match = payload.content.match(
					/<video[^>]+src=['"]([^'"]+)['"][^>]*>/i,
				);
				if (match && match[1] && match[1].trim()) {
					videoUrl = match[1].trim();
				}
			}

			if (!videoUrl && typeof payload.content === "string") {
				const images = extractMarkdownImageUrlsFromText(payload.content);
				if (images.length) {
					assetPayload = {
						type: "image",
						url: images[0],
						thumbnailUrl: null,
					};
				}
			} else if (videoUrl) {
				const thumbnail =
					(typeof payload.thumbnail_url === "string" &&
						payload.thumbnail_url.trim()) ||
					(typeof payload.thumbnailUrl === "string" &&
						payload.thumbnailUrl.trim()) ||
					resultThumb ||
					null;
				assetPayload = {
					type: "video",
					url: videoUrl,
					thumbnailUrl: thumbnail,
				};
				const upstreamPrompt =
					(typeof payload.prompt === "string" &&
						payload.prompt.trim()) ||
					(payload.input &&
						typeof (payload.input as any).prompt === "string" &&
						(payload.input as any).prompt.trim()) ||
					"";
				if (upstreamPrompt) {
					promptForAsset = upstreamPrompt;
				}
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
					prompt: promptForAsset,
					vendor: "sora2api",
					modelKey:
						typeof payload.model === "string"
							? payload.model
							: undefined,
					taskId: taskId ?? null,
				},
			});

			return TaskResultSchema.parse({
				id: taskId,
				kind: "text_to_video",
				status: "succeeded",
				assets: hostedAssets,
				raw: {
					provider: "sora2api",
					response: mergedPayload,
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
				response: mergedPayload,
				progress,
			},
		});
	}

	throw new AppError(lastError?.message || "sora2api 任务查询失败", {
		status: lastError?.status ?? 502,
		code: "sora2api_result_failed",
		details: {
			upstreamStatus: lastError?.status ?? null,
			upstreamData: lastError?.data ?? null,
			endpointTried: lastError?.endpoint ?? null,
		},
	});
}

	// ---------- MiniMax / Hailuo ----------

	function normalizeMiniMaxModelKey(modelKey?: string | null): string {
		const trimmed = (modelKey || "").trim();
		if (!trimmed) return "MiniMax-Hailuo-02";
		const lower = trimmed.toLowerCase();
		if (
			lower === "hailuo" ||
			lower === "hailuo-02" ||
			lower === "minimax-hailuo-02" ||
			lower === "minimax_hailuo_02"
		) {
			return "MiniMax-Hailuo-02";
		}
		if (
			lower === "i2v-01-director" ||
			lower === "i2v_01_director" ||
			lower === "i2v-01_director"
		) {
			return "I2V-01-Director";
		}
		if (lower === "i2v-01-live" || lower === "i2v_01_live") {
			return "I2V-01-live";
		}
		if (lower === "i2v-01" || lower === "i2v_01") {
			return "I2V-01";
		}
		return trimmed;
	}

	function normalizeEnumSeconds(
		requestedSeconds: number | null | undefined,
		allowedSeconds: readonly number[],
		fallbackSeconds: number,
	): { seconds: number; changed: boolean } {
		const fallback =
			typeof fallbackSeconds === "number" && Number.isFinite(fallbackSeconds)
				? Math.floor(fallbackSeconds)
				: 10;
		const requested =
			typeof requestedSeconds === "number" && Number.isFinite(requestedSeconds)
				? Math.floor(requestedSeconds)
				: NaN;

		if (!Number.isFinite(requested) || requested <= 0) {
			return { seconds: fallback, changed: true };
		}

		if (!allowedSeconds.length) {
			return { seconds: requested, changed: false };
		}

		let best = allowedSeconds[0]!;
		let bestDiff = Math.abs(requested - best);
		for (const candidate of allowedSeconds) {
			const diff = Math.abs(requested - candidate);
			if (diff < bestDiff || (diff === bestDiff && candidate > best)) {
				best = candidate;
				bestDiff = diff;
			}
		}
		return { seconds: best, changed: best !== requested };
	}

	function extractMiniMaxErrorMessage(data: any): string | null {
		if (!data) return null;
		const candidates = [
			data?.error?.message,
			data?.error?.msg,
			data?.error?.error_message,
			data?.base_resp?.status_msg,
			data?.message,
			data?.msg,
			data?.error,
		];
		for (const value of candidates) {
			if (typeof value === "string" && value.trim()) return value.trim();
		}
		if (data?.error && typeof data.error === "object") {
			try {
				return JSON.stringify(data.error);
			} catch {
				// ignore
			}
		}
		return null;
	}

	export async function runMiniMaxVideoTask(
		c: AppContext,
		userId: string,
		req: TaskRequestDto,
	): Promise<TaskResult> {
	const progressCtx = extractProgressContext(req, "minimax");
	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });
	emitProgress(userId, progressCtx, { status: "running", progress: 5 });

	const ctx = await resolveVendorContext(c, userId, "minimax");
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = ctx.apiKey.trim();
	if (!baseUrl || !apiKey) {
		throw new AppError("未配置 MiniMax API Key", {
			status: 400,
			code: "minimax_api_key_missing",
		});
		}

		const extras = (req.extras || {}) as Record<string, any>;
		const modelRaw =
			(typeof extras.modelKey === "string" && extras.modelKey.trim()) ||
			"";
		const model = normalizeMiniMaxModelKey(modelRaw);
		const durationSeconds =
			typeof (req as any).durationSeconds === "number" &&
			Number.isFinite((req as any).durationSeconds)
				? Math.floor((req as any).durationSeconds)
			: typeof extras.durationSeconds === "number" &&
					Number.isFinite(extras.durationSeconds)
				? Math.floor(extras.durationSeconds)
				: null;
		const resolution =
			typeof extras.resolution === "string" && extras.resolution.trim()
				? extras.resolution.trim()
				: null;
		const firstFrameImageRaw =
			(typeof (extras as any).first_frame_image === "string" &&
				String((extras as any).first_frame_image).trim()) ||
			(typeof extras.firstFrameImage === "string" &&
				extras.firstFrameImage.trim()) ||
			(typeof extras.firstFrameUrl === "string" &&
				extras.firstFrameUrl.trim()) ||
			(typeof extras.url === "string" && extras.url.trim()) ||
			null;

		if (!firstFrameImageRaw) {
			throw new AppError(
				"MiniMax 图生视频需要提供首帧图片（first_frame_image）",
				{
					status: 400,
					code: "minimax_first_frame_missing",
				},
			);
		}

			const firstFrameImage = await (async () => {
				const trimmed = String(firstFrameImageRaw).trim();
				if (!trimmed) return trimmed;
				if (/^data:image\//i.test(trimmed)) return trimmed;

				if (/^blob:/i.test(trimmed)) {
					throw new AppError(
						"MiniMax 首帧图片不支持 blob: URL，请先上传为可访问的图片地址",
						{
							status: 400,
							code: "minimax_first_frame_invalid",
						},
					);
				}

				const isHttp = /^https?:\/\//i.test(trimmed);
				const isRelative = trimmed.startsWith("/");
				if (!isHttp && !isRelative) {
					throw new AppError(
						"MiniMax 首帧图片必须是 http(s) URL 或 data:image/*;base64,...",
						{
							status: 400,
							code: "minimax_first_frame_invalid",
							details: { firstFrameImage: trimmed.slice(0, 64) },
						},
					);
				}

				const absolute = isRelative
					? new URL(trimmed, new URL(c.req.url).origin).toString()
					: trimmed;

				try {
					// Prefer inlining as base64 to avoid upstreams failing to fetch private/local URLs.
					return await resolveSora2ApiImageUrl(c, absolute);
				} catch (err: any) {
					if (isHttp) {
						// Fallback: still send URL (may work in some deployments)
						return trimmed;
				}
				throw err;
			}
		})();

		const promptOptimizer =
			typeof (extras as any).promptOptimizer === "boolean"
				? (extras as any).promptOptimizer
				: typeof (extras as any).prompt_optimizer === "boolean"
					? (extras as any).prompt_optimizer
					: undefined;

		// MiniMax duration only supports 6s / 10s; normalize to avoid upstream 2013 invalid params.
		const normalizedDuration = normalizeEnumSeconds(
			durationSeconds,
			[6, 10],
			10,
		);

		const body: Record<string, any> = {
			model,
			prompt: req.prompt,
			first_frame_image: firstFrameImage,
			...(typeof normalizedDuration.seconds === "number" &&
			normalizedDuration.seconds > 0
				? { duration: normalizedDuration.seconds }
				: {}),
			...(resolution ? { resolution } : {}),
			...(typeof promptOptimizer === "boolean"
				? { prompt_optimizer: promptOptimizer }
				: {}),
		};

		let res: Response;
		let data: any = null;
		try {
		res = await fetchWithHttpDebugLog(
			c,
			`${baseUrl}/minimax/v1/video_generation`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ tag: "minimax:create" },
		);
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("MiniMax 视频任务创建失败", {
			status: 502,
			code: "minimax_request_failed",
			details: { message: error?.message ?? String(error) },
			});
		}

		if (!res.ok || (typeof data?.base_resp?.status_code === "number" && data.base_resp.status_code !== 0)) {
			const msg =
				extractMiniMaxErrorMessage(data) ||
				`MiniMax 视频任务创建失败：${res.status}`;
			throw new AppError(msg, {
				status:
					typeof data?.base_resp?.status_code === "number" &&
					data.base_resp.status_code !== 0
						? 502
						: res.status,
				code: "minimax_request_failed",
				details: { upstreamStatus: res.status, upstreamData: data ?? null },
			});
		}

	const taskId =
		(typeof data?.task_id === "string" && data.task_id.trim()) ||
		(typeof data?.taskId === "string" && data.taskId.trim()) ||
		(typeof data?.id === "string" && data.id.trim()) ||
		(typeof data?.data?.task_id === "string" && data.data.task_id.trim()) ||
		null;
	if (!taskId) {
		throw new AppError("MiniMax API 未返回 task_id", {
			status: 502,
			code: "minimax_task_id_missing",
			details: { upstreamData: data ?? null },
		});
	}

	emitProgress(userId, progressCtx, {
		status: "running",
		progress: 10,
		taskId,
		raw: data ?? null,
	});

	return TaskResultSchema.parse({
		id: taskId,
		kind: req.kind,
		status: "running",
		assets: [],
		raw: {
			provider: "minimax",
			model,
			taskId,
			response: data ?? null,
		},
	});
}

function normalizeMiniMaxStatus(value: unknown): TaskStatus {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (!normalized) return "running";
		if (
			normalized === "queued" ||
			normalized === "queue" ||
			normalized === "pending" ||
			normalized === "waiting"
		) {
			return "queued";
		}
		if (
			normalized === "running" ||
			normalized === "processing" ||
			normalized === "in_progress" ||
			normalized === "in-progress" ||
			normalized === "generating"
		) {
			return "running";
		}
		if (
			normalized === "success" ||
			normalized === "succeeded" ||
			normalized === "completed" ||
			normalized === "done" ||
			normalized === "finish" ||
			normalized === "finished"
		) {
			return "succeeded";
		}
		if (
			normalized === "fail" ||
			normalized === "failed" ||
			normalized === "failure" ||
			normalized === "error"
		) {
			return "failed";
		}
		return "running";
	}

	// Some MiniMax gateways return numeric status codes:
	// 0=queued, 1=running, 2=succeeded, 3=failed (best-effort mapping).
	if (typeof value === "number" && Number.isFinite(value)) {
		const code = Math.floor(value);
		if (code === 2) return "succeeded";
		if (code === 3 || code === -1) return "failed";
		if (code === 0) return "queued";
		return "running";
	}

	if (typeof value === "boolean") {
		return value ? "succeeded" : "running";
	}

	return "running";
}

function extractMiniMaxVideoUrl(payload: any): string | null {
	const pick = (v: any): string | null =>
		typeof v === "string" && v.trim() ? v.trim() : null;
	const file =
		(payload?.file && typeof payload.file === "object" ? payload.file : null) ||
		(payload?.data?.file && typeof payload.data.file === "object"
			? payload.data.file
			: null) ||
		null;
	return (
		pick(payload?.video_url) ||
		pick(payload?.videoUrl) ||
		pick(payload?.url) ||
		pick(payload?.file_url) ||
		pick(payload?.fileUrl) ||
		pick(payload?.download_url) ||
		pick(payload?.downloadUrl) ||
		pick(file?.download_url) ||
		pick(file?.downloadUrl) ||
		pick(file?.url) ||
		pick(file?.file_url) ||
		pick(file?.fileUrl) ||
		(Array.isArray(payload?.results) && payload.results.length
			? pick(payload.results[0]?.url) ||
				pick(payload.results[0]?.video_url) ||
				pick(payload.results[0]?.videoUrl)
			: null) ||
		null
	);
}

export async function fetchMiniMaxTaskResult(
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

	const ctx = await resolveVendorContext(c, userId, "minimax");
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = ctx.apiKey.trim();
	if (!baseUrl || !apiKey) {
		throw new AppError("未配置 MiniMax API Key", {
			status: 400,
			code: "minimax_api_key_missing",
		});
	}

		const makeUrl = (key: string) => {
			const qs = new URLSearchParams();
			qs.append(key, taskId.trim());
			return `${baseUrl}/minimax/v1/query/video_generation?${qs.toString()}`;
		};

		const tryFetch = async (url: string, tag: string) => {
			const res = await fetchWithHttpDebugLog(
				c,
				url,
				{
					method: "GET",
					headers: {
						Authorization: `Bearer ${apiKey}`,
					},
				},
				{ tag },
			);
			let data: any = null;
			try {
				data = await res.json();
			} catch {
				data = null;
			}
			return { res, data };
		};

		let res: Response;
		let data: any = null;
		try {
			({ res, data } = await tryFetch(makeUrl("task_id"), "minimax:result"));
		} catch (error: any) {
			throw new AppError("MiniMax 结果查询失败", {
				status: 502,
				code: "minimax_result_failed",
				details: { message: error?.message ?? String(error) },
			});
		}

		// Some MiniMax gateways expect array-form query params (task_id[]=...).
		if (!res.ok && res.status === 400) {
			try {
				const retry = await tryFetch(makeUrl("task_id[]"), "minimax:result:array");
				if (retry.res.ok) {
					res = retry.res;
					data = retry.data;
				} else {
					// keep original error response for reporting
				}
			} catch {
				// ignore retry errors
			}
		}

		if (!res.ok) {
			const msg =
				extractMiniMaxErrorMessage(data) || `MiniMax 结果查询失败: ${res.status}`;
			throw new AppError(msg, {
				status: res.status,
				code: "minimax_result_failed",
				details: { upstreamStatus: res.status, upstreamData: data ?? null },
			});
		}

	const payload = data?.data ?? data ?? {};
	const status = normalizeMiniMaxStatus(payload?.status ?? data?.status);
	const progress = parseComflyProgress(payload?.progress || data?.progress);
	const videoUrlFromPayload = extractMiniMaxVideoUrl(payload);

	if (status === "failed") {
		const msg =
			(typeof payload?.base_resp?.status_msg === "string" &&
				payload.base_resp.status_msg.trim()) ||
			(typeof payload?.message === "string" && payload.message.trim()) ||
			(typeof payload?.error === "string" && payload.error.trim()) ||
			"MiniMax 视频任务失败";
		return TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "failed",
			assets: [],
			raw: {
				provider: "minimax",
				response: payload,
				progress,
				message: msg,
			},
		});
	}

	// Some gateways may not provide a reliable `status` field; when a video URL exists,
	// treat the task as succeeded to unblock the frontend polling loop.
	if (videoUrlFromPayload && status !== "failed") {
		const asset = TaskAssetSchema.parse({
			type: "video",
			url: videoUrlFromPayload,
			thumbnailUrl: null,
		});
		const hostedAssets = await hostTaskAssetsInWorker({
			c,
			userId,
			assets: [asset],
			meta: {
				taskKind: "text_to_video",
				prompt:
					typeof payload?.prompt === "string" && payload.prompt.trim()
						? payload.prompt.trim()
						: null,
				vendor: "minimax",
				modelKey:
					typeof payload?.model === "string" && payload.model.trim()
						? payload.model.trim()
						: undefined,
				taskId,
			},
		});

		return TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "succeeded",
			assets: hostedAssets,
			raw: {
				provider: "minimax",
				response: payload,
			},
		});
	}

	if (status !== "succeeded") {
		return TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status,
			assets: [],
			raw: {
				provider: "minimax",
				response: payload,
				progress,
			},
		});
	}

	const videoUrl = videoUrlFromPayload;
	if (!videoUrl) {
		return TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "failed",
			assets: [],
			raw: {
				provider: "minimax",
				response: payload,
				progress,
				message:
					"MiniMax 任务已完成但未返回视频链接（缺少 url/video_url）",
			},
		});
	}

	const asset = TaskAssetSchema.parse({
		type: "video",
		url: videoUrl,
		thumbnailUrl: null,
	});
	const hostedAssets = await hostTaskAssetsInWorker({
		c,
		userId,
		assets: [asset],
		meta: {
			taskKind: "text_to_video",
			prompt:
				typeof payload?.prompt === "string" && payload.prompt.trim()
					? payload.prompt.trim()
					: null,
			vendor: "minimax",
			modelKey:
				typeof payload?.model === "string" && payload.model.trim()
					? payload.model.trim()
					: undefined,
			taskId,
		},
	});

	return TaskResultSchema.parse({
		id: taskId,
		kind: "text_to_video",
		status: "succeeded",
		assets: hostedAssets,
		raw: {
			provider: "minimax",
			response: payload,
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
	c: AppContext,
	url: string,
	init: RequestInit,
	errorContext: { provider: string },
): Promise<any> {
	let res: Response;
	try {
		res = await fetchWithHttpDebugLog(c, url, init, {
			tag: `${errorContext.provider}:jsonApi`,
		});
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

// 解析通用 SSE 文本，提取最后一个 data: JSON payload
function parseSseJsonPayloadForTask(raw: string): any | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	const normalized = raw.replace(/\r/g, "");
	const chunks = normalized.split(/\n\n+/);
	let last: any = null;
	for (const chunk of chunks) {
		const trimmedChunk = chunk.trim();
		if (!trimmedChunk) continue;
		const lines = trimmedChunk.split("\n");
		for (const line of lines) {
			const match = line.match(/^\s*data:\s*(.+)$/i);
			if (!match) continue;
			const payload = match[1].trim();
			if (!payload || payload === "[DONE]") continue;
			const parsed = safeParseJsonForTask(payload);
			if (parsed) last = parsed;
		}
	}
	return last;
}

	function extractMarkdownImageUrlsFromText(text: string): string[] {
		if (typeof text !== "string" || !text.trim()) return [];
		const urls = new Set<string>();
		const regex = /!\[[^\]]*]\(([^)]+)\)/g;
		let match: RegExpExecArray | null;
		// eslint-disable-next-line no-cond-assign
		while ((match = regex.exec(text)) !== null) {
			const raw = (match[1] || "").trim();
			const first = raw.split(/\s+/)[0] || "";
			const url = first.replace(/^<(.+)>$/, "$1").trim();
			if (url) urls.add(url);
		}
		return Array.from(urls);
	}

	function extractMarkdownLinkUrlsFromText(text: string): string[] {
		if (typeof text !== "string" || !text.trim()) return [];
		const urls = new Set<string>();
		const regex = /\[[^\]]*]\(([^)]+)\)/g;
		let match: RegExpExecArray | null;
		// eslint-disable-next-line no-cond-assign
		while ((match = regex.exec(text)) !== null) {
			const raw = (match[1] || "").trim();
			const first = raw.split(/\s+/)[0] || "";
			const url = first.replace(/^<(.+)>$/, "$1").trim();
			if (url) urls.add(url);
		}
		return Array.from(urls);
	}

	function extractHtmlVideoUrlsFromText(text: string): string[] {
		if (typeof text !== "string" || !text.trim()) return [];
		const urls = new Set<string>();
		const regexes = [
			/<video[^>]*\ssrc=['"]([^'"]+)['"][^>]*>/gi,
			/<source[^>]*\ssrc=['"]([^'"]+)['"][^>]*>/gi,
		];
		for (const regex of regexes) {
			let match: RegExpExecArray | null;
			// eslint-disable-next-line no-cond-assign
			while ((match = regex.exec(text)) !== null) {
				const url = (match[1] || "").trim();
				if (url) urls.add(url);
			}
		}
		return Array.from(urls);
	}

	function looksLikeVideoUrl(url: string): boolean {
		const lower = (url || "").toLowerCase();
		if (!lower) return false;
		if (/\.(mp4|webm|mov|m4v)(\?|#|$)/.test(lower)) return true;
		// sora2api cache may return local /tmp/* links without extensions.
		if (lower.includes("/tmp/")) return true;
		return false;
	}

	function arrayBufferToBase64(buf: ArrayBuffer): string {
		const bytes = new Uint8Array(buf);
		let binary = "";
		const chunkSize = 0x2000;
		for (let i = 0; i < bytes.length; i += chunkSize) {
			const chunk = bytes.subarray(i, i + chunkSize);
			binary += String.fromCharCode(...chunk);
		}
		return btoa(binary);
	}

	async function resolveSora2ApiImageUrl(
		c: AppContext,
		url: string,
	): Promise<string> {
		const trimmed = (url || "").trim();
		if (!trimmed) return trimmed;
		if (/^data:image\//i.test(trimmed)) return trimmed;
		if (/^blob:/i.test(trimmed)) {
			throw new AppError(
				"blob: URL 无法在 Worker 侧下载，请先上传为可访问的图片地址",
				{
					status: 400,
					code: "invalid_image_url",
					details: { url: trimmed.slice(0, 64) },
				},
			);
		}

		let resolved = trimmed;
		if (resolved.startsWith("/")) {
			try {
				resolved = new URL(resolved, new URL(c.req.url).origin).toString();
			} catch {
				return trimmed;
			}
		}

		if (!/^https?:\/\//i.test(resolved)) return trimmed;

		const MAX_BYTES = 8 * 1024 * 1024;
		const res = await fetchWithHttpDebugLog(
			c,
			resolved,
			{ method: "GET" },
			{ tag: "sora2api:imageFetch" },
		);
		if (!res.ok) {
			throw new AppError(`参考图下载失败: ${res.status}`, {
				status: 502,
				code: "image_fetch_failed",
				details: { upstreamStatus: res.status, url: resolved },
			});
		}

		const ct = (res.headers.get("content-type") || "").toLowerCase();
		if (!ct.startsWith("image/")) {
			throw new AppError("参考图不是 image/* 内容", {
				status: 400,
				code: "invalid_image_content_type",
				details: { contentType: ct, url: resolved },
			});
		}

		const lenHeader = res.headers.get("content-length");
		const len =
			typeof lenHeader === "string" && /^\d+$/.test(lenHeader)
				? Number(lenHeader)
				: null;
		if (typeof len === "number" && Number.isFinite(len) && len > MAX_BYTES) {
			throw new AppError("参考图过大，无法转换为 base64", {
				status: 400,
				code: "image_too_large",
				details: { contentLength: len, maxBytes: MAX_BYTES, url: resolved },
			});
		}

		const buf = await res.arrayBuffer();
		if (buf.byteLength > MAX_BYTES) {
			throw new AppError("参考图过大，无法转换为 base64", {
				status: 400,
				code: "image_too_large",
				details: {
					contentLength: buf.byteLength,
					maxBytes: MAX_BYTES,
					url: resolved,
				},
			});
		}

		const base64 = arrayBufferToBase64(buf);
		return `data:${ct};base64,${base64}`;
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
	c: AppContext,
	url: string,
	apiKey: string,
	body: Record<string, any>,
): Promise<{ parsed: any; rawBody: string }> {
	let res: Response;
	try {
		res = await fetchWithHttpDebugLog(
			c,
			url,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ tag: "openai:responses" },
		);
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
		"gpt-5.2";

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
			c,
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
		"gpt-5.2";

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
			c,
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

	const endpointBase = `${base.replace(/\/+$/, "")}/v1beta/${model}:generateContent`;
	const url =
		ctx.viaProxyVendor === "comfly"
			? endpointBase
			: `${endpointBase}?key=${encodeURIComponent(apiKey)}`;

	const data = await callJsonApi(
		c,
		url,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(ctx.viaProxyVendor === "comfly"
					? { Authorization: `Bearer ${apiKey}` }
					: {}),
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

	if (ctx.viaProxyVendor === "comfly") {
		const modelId = normalizeComflyGeminiModelId(normalizedModel);
		const resolvedAspect =
			typeof aspectRatio === "string" &&
			aspectRatio.trim() &&
			aspectRatio.trim().toLowerCase() !== "auto"
				? aspectRatio.trim()
				: null;

		const parts: any[] = [];
		for (const url of referenceImages.slice(0, 4)) {
			const dataUrl = await resolveSora2ApiImageUrl(c, url);
			const match = typeof dataUrl === "string"
				? dataUrl.match(/^data:([^;]+);base64,(.+)$/i)
				: null;
			if (!match) continue;
			const mimeType = match[1] || "";
			const data = match[2] || "";
			if (!mimeType || !data) continue;
			parts.push({ inlineData: { mimeType, data } });
		}
		parts.push({ text: req.prompt });

		const generationConfig: any = {
			responseModalities: ["IMAGE"],
		};
		if (resolvedAspect || imageSize) {
			generationConfig.imageConfig = {
				...(resolvedAspect ? { aspectRatio: resolvedAspect } : {}),
				...(imageSize ? { imageSize } : {}),
			};
		}

		const url = `${baseUrl}/v1beta/models/${encodeURIComponent(
			modelId,
		)}:generateContent`;
		const data = await callJsonApi(
			c,
			url,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					contents: [{ role: "user", parts }],
					generationConfig,
				}),
			},
			{ provider: "comfly" },
		);

		const images: Array<{ mimeType: string; data: string }> = [];
		const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
		for (const cand of candidates) {
			const candParts = Array.isArray(cand?.content?.parts)
				? cand.content.parts
				: [];
			for (const part of candParts) {
				const inline =
					part?.inlineData ||
					part?.inline_data ||
					part?.inline ||
					null;
				const mimeType =
					(typeof inline?.mimeType === "string" && inline.mimeType.trim()) ||
					(typeof inline?.mime_type === "string" && inline.mime_type.trim()) ||
					"";
				const b64 =
					(typeof inline?.data === "string" && inline.data.trim()) ||
					(typeof inline?.b64 === "string" && inline.b64.trim()) ||
					"";
				if (mimeType && b64) {
					images.push({ mimeType, data: b64 });
				}
			}
		}

		const uploadedUrls: string[] = [];
		for (const img of images.slice(0, 4)) {
			const url = await uploadInlineImageToR2({
				c,
				userId,
				mimeType: img.mimeType,
				base64: img.data,
				prefix: "gen/images",
			});
			uploadedUrls.push(url);
		}

		const assets = uploadedUrls.map((url) =>
			TaskAssetSchema.parse({ type: "image", url, thumbnailUrl: null }),
		);

		return TaskResultSchema.parse({
			id: `banana-${Date.now().toString(36)}`,
			kind: req.kind,
			status: assets.length ? "succeeded" : "failed",
			assets,
			raw: {
				provider: "gemini",
				vendor: "comfly",
				model: modelId,
				response: data ?? null,
			},
		});
	}

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
		res = await fetchWithHttpDebugLog(
			c,
			endpoint,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: shouldStreamProgress
						? "text/event-stream,application/json"
						: "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ tag: "banana:image" },
		);
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
		c,
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

// ---- Sora2API 图像（text_to_image / image_edit） ----

	function normalizeSora2ApiImageModelKey(modelKey?: string | null): string {
		const trimmed = (modelKey || "").trim();
		if (!trimmed) return "gemini-2.5-flash-image-landscape";
		const normalized = trimmed.startsWith("models/")
			? trimmed.slice(7)
			: trimmed;

		if (/^nano-banana-pro/i.test(normalized)) return "gemini-3.0-pro-image-landscape";
		if (/^nano-banana/i.test(normalized)) return "gemini-2.5-flash-image-landscape";

		// Sora2API is a unified OpenAI-compatible gateway; accept known image-capable model ids.
		if (
			/^sora-image/i.test(normalized) ||
			/^gemini-.*-image($|-(landscape|portrait)$)/i.test(normalized) ||
			/^imagen-.*($|-(landscape|portrait)$)/i.test(normalized)
		) {
			return normalized;
		}

		return "gemini-2.5-flash-image-landscape";
	}

	async function runSora2ApiImageTask(
		c: AppContext,
		userId: string,
		req: TaskRequestDto,
		progressVendor: string = "sora2api",
	): Promise<TaskResult> {
		const progressCtx = extractProgressContext(req, progressVendor);
		emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

	const ctx = await resolveVendorContext(c, userId, "sora2api");
	const baseUrl = normalizeBaseUrl(ctx.baseUrl) || "http://localhost:8000";
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 sora2api API Key", {
			status: 400,
			code: "sora2api_api_key_missing",
		});
	}

	const extras = (req.extras || {}) as Record<string, any>;
	const modelKeyRaw = typeof extras.modelKey === "string" ? extras.modelKey.trim() : "";
	const defaultGeminiModelKey = (() => {
		const isPortrait = (() => {
			if (typeof req.width === "number" && typeof req.height === "number") return req.height > req.width;
			const ar = typeof extras.aspectRatio === "string" ? extras.aspectRatio.toLowerCase().trim() : "";
			if (ar.includes("portrait")) return true;
			if (ar.includes("landscape")) return false;
			const ratio = ar.match(/(\d+(?:\.\d+)?)\s*[:x\/\*]\s*(\d+(?:\.\d+)?)/);
			if (ratio) {
				const w = Number(ratio[1]);
				const h = Number(ratio[2]);
				if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return h > w;
			}
			return false;
		})();
		return "gemini-2.5-flash-image-" + (isPortrait ? "portrait" : "landscape");
	})();
	const model = normalizeSora2ApiImageModelKey(modelKeyRaw || defaultGeminiModelKey);

	const promptParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
		{ type: "text", text: req.prompt },
	];
	const referenceImages: string[] = Array.isArray(extras.referenceImages)
		? extras.referenceImages
				.map((url: any) =>
					typeof url === "string" ? url.trim() : "",
				)
				.filter((url: string) => url.length > 0)
		: [];
		if (referenceImages.length) {
			// sora2api 兼容 OpenAI chat.completions 的 image_url 内容格式
			const dataUrl = await resolveSora2ApiImageUrl(c, referenceImages[0]!);
			promptParts.push({
				type: "image_url",
				image_url: { url: dataUrl },
			});
		}

	const body: any = {
		model,
		messages: [
			{
				role: "user",
				content: promptParts.length === 1 ? req.prompt : promptParts,
			},
		],
		stream: true,
	};

	emitProgress(userId, progressCtx, { status: "running", progress: 5 });

	let res: Response;
	let rawText = "";
	try {
		res = await fetchWithHttpDebugLog(
			c,
			`${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream,application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ tag: "sora2api:chatCompletions" },
		);
		rawText = await res.text().catch(() => "");
	} catch (error: any) {
		throw new AppError("sora2api 图片请求失败", {
			status: 502,
			code: "sora2api_request_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	const ct = (res.headers.get("content-type") || "").toLowerCase();
	const parsedBody = (() => {
		if (ct.includes("application/json")) {
			return safeParseJsonForTask(rawText) || null;
		}
		return parseSseJsonPayloadForTask(rawText) || safeParseJsonForTask(rawText);
	})();

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(parsedBody &&
				(parsedBody.error?.message ||
					parsedBody.message ||
					parsedBody.error)) ||
			`sora2api 图像调用失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora2api_request_failed",
			details: { upstreamStatus: res.status, upstreamData: parsedBody ?? rawText },
		});
	}

	const payload = parsedBody;
	const urls = (() => {
		const collected = new Set<string>();
		extractBananaImageUrls(payload).forEach((url) => collected.add(url));

		const appendFromText = (value: any) => {
			if (!value) return;
			if (typeof value === "string") {
				extractMarkdownImageUrlsFromText(value).forEach((url) =>
					collected.add(url),
				);
				return;
			}
			if (Array.isArray(value)) {
				value.forEach((part) => {
					if (!part) return;
					if (typeof part === "string") {
						extractMarkdownImageUrlsFromText(part).forEach((url) =>
							collected.add(url),
						);
						return;
					}
					if (typeof part === "object" && typeof part.text === "string") {
						extractMarkdownImageUrlsFromText(part.text).forEach((url) =>
							collected.add(url),
						);
					}
				});
			}
		};

		appendFromText(payload?.content);
		if (Array.isArray(payload?.choices)) {
			for (const choice of payload.choices) {
				appendFromText(choice?.delta?.content);
				appendFromText(choice?.message?.content);
				appendFromText(choice?.content);
			}
		}

		// Fallback: parse URLs from the raw SSE buffer when payload-only parsing fails.
		if (collected.size === 0 && typeof rawText === "string" && rawText.trim()) {
			extractMarkdownImageUrlsFromText(rawText).forEach((url) =>
				collected.add(url),
			);
		}

		return Array.from(collected);
	})();
	const assets = urls.map((url) =>
		TaskAssetSchema.parse({ type: "image", url, thumbnailUrl: null }),
	);

	const id =
		(typeof payload?.id === "string" && payload.id.trim()) ||
		`sd-img-${Date.now().toString(36)}`;
	const status: "succeeded" | "failed" = assets.length ? "succeeded" : "failed";

	emitProgress(userId, progressCtx, {
		status: status === "succeeded" ? "succeeded" : "failed",
		progress: 100,
		assets,
		raw: { response: payload },
	});

		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status,
			assets,
			raw: {
				provider: "sora2api",
				model,
				response: payload,
				rawBody: rawText,
			},
		});
	}

	async function runSora2ApiChatCompletionsVideoTask(
		c: AppContext,
		userId: string,
		req: TaskRequestDto,
		options: { model: string; progressVendor: string },
	): Promise<TaskResult> {
		const progressCtx = extractProgressContext(req, options.progressVendor);
		emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

		const ctx = await resolveVendorContext(c, userId, "sora2api");
		const baseUrl = normalizeBaseUrl(ctx.baseUrl) || "http://localhost:8000";
		const apiKey = ctx.apiKey.trim();
		if (!apiKey) {
			throw new AppError("未配置 sora2api API Key", {
				status: 400,
				code: "sora2api_api_key_missing",
			});
		}

		const extras = (req.extras || {}) as Record<string, any>;
		const model = options.model;

		const firstFrameUrl =
			typeof extras.firstFrameUrl === "string" && extras.firstFrameUrl.trim()
				? extras.firstFrameUrl.trim()
				: undefined;
		const lastFrameUrl =
			typeof extras.lastFrameUrl === "string" && extras.lastFrameUrl.trim()
				? extras.lastFrameUrl.trim()
				: undefined;

		const rawUrls: string[] = [];
		const appendUrl = (value: any) => {
			if (typeof value === "string" && value.trim()) rawUrls.push(value.trim());
		};
		if (Array.isArray(extras.referenceImages))
			extras.referenceImages.forEach(appendUrl);
		if (Array.isArray(extras.urls)) extras.urls.forEach(appendUrl);
		const referenceImages = Array.from(new Set(rawUrls)).filter(Boolean);

		const parts: any[] = [{ type: "text", text: req.prompt }];

		// Mode rules (aligned with local sora2api implementation notes):
		// - t2v: ignore images
		// - i2v: must provide 1~2 images (first=START, second=END)
		// - r2v: provide 0~N reference images
		const isI2v = !!firstFrameUrl;
		if (isI2v) {
			const startDataUrl = await resolveSora2ApiImageUrl(c, firstFrameUrl!);
			parts.push({ type: "image_url", image_url: { url: startDataUrl } });
			if (lastFrameUrl) {
				const endDataUrl = await resolveSora2ApiImageUrl(c, lastFrameUrl);
				parts.push({ type: "image_url", image_url: { url: endDataUrl } });
			}
		} else if (referenceImages.length) {
			for (const url of referenceImages.slice(0, 8)) {
				const dataUrl = await resolveSora2ApiImageUrl(c, url);
				parts.push({ type: "image_url", image_url: { url: dataUrl } });
			}
		}

		const body: any = {
			model,
			messages: [
				{
					role: "user",
					content: parts.length === 1 ? req.prompt : parts,
				},
			],
			stream: true,
		};

		emitProgress(userId, progressCtx, { status: "running", progress: 5 });

		let res: Response;
		let rawText = "";
		try {
			res = await fetchWithHttpDebugLog(
				c,
				`${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "text/event-stream,application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(body),
				},
				{ tag: "sora2api:chatCompletions" },
			);
			rawText = await res.text().catch(() => "");
		} catch (error: any) {
			throw new AppError("sora2api 视频请求失败", {
				status: 502,
				code: "sora2api_request_failed",
				details: { message: error?.message ?? String(error) },
			});
		}

		const ct = (res.headers.get("content-type") || "").toLowerCase();
		const parsedBody = (() => {
			if (ct.includes("application/json")) {
				return safeParseJsonForTask(rawText) || null;
			}
			return parseSseJsonPayloadForTask(rawText) || safeParseJsonForTask(rawText);
		})();

		if (res.status < 200 || res.status >= 300) {
			const msg =
				(parsedBody &&
					(parsedBody.error?.message ||
						parsedBody.message ||
						parsedBody.error)) ||
				`sora2api 视频调用失败: ${res.status}`;
			throw new AppError(msg, {
				status: res.status,
				code: "sora2api_request_failed",
				details: { upstreamStatus: res.status, upstreamData: parsedBody ?? rawText },
			});
		}

		const payload = parsedBody;
		const urls = (() => {
			const collected = new Set<string>();

			const appendFromText = (value: any) => {
				if (!value) return;
				if (typeof value === "string") {
					extractHtmlVideoUrlsFromText(value).forEach((url) =>
						collected.add(url),
					);
					extractMarkdownLinkUrlsFromText(value)
						.filter(looksLikeVideoUrl)
						.forEach((url) => collected.add(url));
					return;
				}
				if (Array.isArray(value)) {
					value.forEach((part) => {
						if (!part) return;
						if (typeof part === "string") {
							extractHtmlVideoUrlsFromText(part).forEach((url) =>
								collected.add(url),
							);
							extractMarkdownLinkUrlsFromText(part)
								.filter(looksLikeVideoUrl)
								.forEach((url) => collected.add(url));
							return;
						}
						if (typeof part === "object" && typeof part.text === "string") {
							extractHtmlVideoUrlsFromText(part.text).forEach((url) =>
								collected.add(url),
							);
							extractMarkdownLinkUrlsFromText(part.text)
								.filter(looksLikeVideoUrl)
								.forEach((url) => collected.add(url));
						}
					});
				}
			};

			appendFromText(payload?.content);
			if (Array.isArray(payload?.choices)) {
				for (const choice of payload.choices) {
					appendFromText(choice?.delta?.content);
					appendFromText(choice?.message?.content);
					appendFromText(choice?.content);
				}
			}

			if (collected.size === 0 && typeof rawText === "string" && rawText.trim()) {
				extractHtmlVideoUrlsFromText(rawText).forEach((url) =>
					collected.add(url),
				);
				extractMarkdownLinkUrlsFromText(rawText)
					.filter(looksLikeVideoUrl)
					.forEach((url) => collected.add(url));
			}

			return Array.from(collected);
		})();

		const assets = urls.map((url) =>
			TaskAssetSchema.parse({ type: "video", url, thumbnailUrl: null }),
		);

		const id =
			(typeof payload?.id === "string" && payload.id.trim()) ||
			`veo-${Date.now().toString(36)}`;
		const status: "succeeded" | "failed" = assets.length ? "succeeded" : "failed";

		emitProgress(userId, progressCtx, {
			status,
			progress: 100,
			assets,
			raw: { response: payload },
		});

		return TaskResultSchema.parse({
			id,
			kind: "text_to_video",
			status,
			assets,
			raw: {
				provider: "sora2api",
				model,
				response: payload,
				rawBody: rawText,
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
		c,
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
	const v = normalizeVendorKey(vendor);
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
			} else if (req.kind === "text_to_image" || req.kind === "image_edit") {
				// OpenAI 文生图在 Worker 侧通过 Gemini Banana / sora2api 代理实现
				throw new AppError(
					"OpenAI 目前仅支持 chat/prompt_refine/image_to_prompt",
					{ status: 400, code: "unsupported_task_kind" },
				);
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
					try {
						result = await runGeminiBananaImageTask(c, userId, req);
					} catch (err: any) {
						// Fallback: when Gemini/Banana isn't configured, try sora2api OpenAI-compatible gateway.
						const code =
							typeof err?.code === "string"
								? err.code
								: typeof err?.details?.code === "string"
									? err.details.code
									: null;
						if (
							code === "api_key_missing" ||
							code === "banana_api_key_missing" ||
							code === "provider_not_configured" ||
							code === "base_url_missing" ||
							code === "key_missing"
						) {
							const reqForSora2Api = (() => {
								const extras = (req.extras || {}) as Record<string, any>;
								const mk = typeof extras.modelKey === "string" ? extras.modelKey.trim() : "";
								if (/^nano-banana/i.test(mk)) {
									const isPortrait = (() => {
										if (typeof req.width === "number" && typeof req.height === "number") return req.height > req.width;
										const ar = typeof extras.aspectRatio === "string" ? extras.aspectRatio.toLowerCase().trim() : "";
										if (ar.includes("portrait")) return true;
										if (ar.includes("landscape")) return false;
										const ratio = ar.match(/(\d+(?:\.\d+)?)\s*[:x\/\*]\s*(\d+(?:\.\d+)?)/);
										if (ratio) {
											const w = Number(ratio[1]);
											const h = Number(ratio[2]);
											if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return h > w;
										}
										return false;
									})();
									const family = /^nano-banana-pro/i.test(mk) ? "gemini-3.0-pro-image" : "gemini-2.5-flash-image";
									const mappedModelKey = family + "-" + (isPortrait ? "portrait" : "landscape");
									return { ...req, extras: { ...extras, modelKey: mappedModelKey } };
								}
								return req;
							})();
							result = await runSora2ApiImageTask(c, userId, reqForSora2Api, "gemini");
						} else {
							throw err;
						}
					}
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
		} else if (v === "sora2api") {
			if (req.kind === "text_to_image" || req.kind === "image_edit") {
				result = await runSora2ApiImageTask(c, userId, req);
			} else {
				throw new AppError(
					"sora2api 目前仅在 Worker 中支持 text_to_image/image_edit 或 text_to_video",
					{ status: 400, code: "unsupported_task_kind" },
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
			// 将生成结果写入 assets（默认托管到 OSS/R2 并替换 URL；ASSET_HOSTING_DISABLED=1 时保持源 URL）
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
					taskId:
						(typeof result.id === "string" && result.id.trim()) ||
						null,
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
