import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { getPrismaClient } from "../../platform/node/prisma";
import { createSseEventParser } from "../../utils/sse";
import type { SseEventMessage } from "../../utils/sse";
import type {
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
import {
	hostTaskAssetsInWorker,
	stageTaskAssetsForAsyncHosting,
} from "../asset/asset.hosting";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import { ensureModelCatalogSchema } from "../model-catalog/model-catalog.repo";
import { ModelCatalogImageOptionsSchema } from "../model-catalog/model-catalog.schemas";
import { listNewApiModels } from "../new-api-models/new-api-models.service";
import { normalizeBillingModelKey } from "../billing/billing.models";
import {
	isSupportedImageMimeType,
	normalizeMimeType,
} from "./task.mime";
import {
	getVendorTaskRefByTaskId,
} from "./vendor-task-refs.repo";
import { getTaskResultByTaskId } from "./task-result.repo";
import {
	ensureVendorCallLogsSchema,
	upsertVendorCallLogFinal,
	upsertVendorCallLogPayloads,
} from "./vendor-call-logs.repo";
import {
	bindTeamCreditsReservationToTaskId,
	requireSufficientTeamCredits,
	releaseTeamCreditsOnFailure,
	settleTeamCreditsOnSuccess,
} from "../team/team.service";
import { resolveTeamCreditsCostForTask } from "../billing/billing.service";
import { setTraceStage } from "../../trace";
import {
	extractUpstreamErrorMessage,
	fetchJsonWithDebug,
	resolveRequiredVendorHttpContext,
} from "./task.http-utils";
import {
	buildStoredFailedTaskResult,
	buildStoredQueuedTaskResult,
	buildStoredRunningTaskResult,
	persistStoredTaskResult,
	resolveImageVendorApiKeyMissingMessage,
	resolveStoredTaskId,
	resolveStoredTaskRefKind,
	upsertStoredTaskRefSafely,
	upsertVendorTaskRefWithWarn,
} from "./task.stored-task-utils";
import {
	decodeBase64ToBytes,
	detectImageExtensionFromMimeType,
} from "./task.inline-asset-utils";
import {
	recordVendorCallForTaskResult,
	recordVendorCallPayloads,
} from "./task.vendor-call-utils";
import {
	attachBillingSpecKeyToRaw,
	extractBillingSpecKeyFromTaskRequest,
} from "./task.billing";
import {
	defaultBaseUrlForVendor,
	findSharedTokenForVendor,
	normalizeGeminiBaseUrl,
	requiresApiKeyForVendor,
	resolveSharedBaseUrl,
	resolveSystemVendorApiKeyContext,
	resolveSystemVendorBaseUrlHint,
} from "./task.vendor-config-utils";
import {
	expandProxyVendorKeys,
	isYunwuBaseUrl,
	normalizeBaseUrl,
	normalizeVendorKey,
	normalizeYunwuBaseUrl,
} from "./task.vendor-utils";
import {
	buildYunwuKlingImageList,
	extractYunwuKlingTaskStatus,
	extractYunwuKlingVideoUrl,
	extractYunwuModelFromVendorRef,
	inferYunwuAspectRatio,
	isYunwuKlingOmniModel,
	normalizeYunwuKlingDurationSeconds,
} from "./task.yunwu-video";
import {
	buildKlingMotionControlMetadata,
	extractKlingMotionModeFromSpecKey,
	isKlingMotionControlModel,
	normalizeKlingCharacterOrientation,
	normalizeKlingKeepOriginalSound,
	normalizeKlingMotionMode,
	validateKlingMotionDurationSeconds,
} from "./task.kling-motion-control";
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

type TeamCreditsReservation = Awaited<
	ReturnType<typeof requireSufficientTeamCredits>
>;

type TaskAssetHostingMetaInput = {
	taskKind: TaskRequestDto["kind"];
	prompt: string | null;
	vendor: string;
	modelKey?: string | null;
	taskId: string | null;
};

function attachBillingSpecKeyToTaskResult(
	result: TaskResult,
	specKey: string | null,
): TaskResult {
	if (!specKey) return result;
	return TaskResultSchema.parse({
		...result,
		raw: attachBillingSpecKeyToRaw(result.raw, specKey),
	});
}

function isHostedTaskAssetUrl(c: AppContext, url: string): boolean {
	const trimmed = url.trim();
	if (!trimmed) return false;
	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	if (publicBase) return trimmed.startsWith(`${publicBase}/`);
	return /^\/?gen\//.test(trimmed);
}

async function hostTaskAssetsSynchronously(options: {
	c: AppContext;
	userId: string;
	result: TaskResult;
	meta: TaskAssetHostingMetaInput;
	traceTaskKind: TaskRequestDto["kind"];
	traceVendor: string;
}): Promise<TaskResult> {
	const { c, userId, result, meta, traceTaskKind, traceVendor } = options;
	if (result.status !== "succeeded" || result.assets.length === 0) {
		return result;
	}

	setTraceStage(c, "task:asset_hosting:begin", {
		vendor: traceVendor,
		taskKind: traceTaskKind,
		assetCount: result.assets.length,
		mode: "sync",
	});

	const hostedAssets = await hostTaskAssetsInWorker({
		c,
		userId,
		assets: result.assets,
		meta,
	});

	const unhostedAssets = hostedAssets.filter(
		(asset) => !isHostedTaskAssetUrl(c, asset.url),
	);
	if (unhostedAssets.length > 0) {
		const sampleUrls = unhostedAssets
			.map((asset) => asset.url.trim())
			.filter((url) => url.length > 0)
			.slice(0, 3);
		setTraceStage(c, "task:asset_hosting:error", {
			vendor: traceVendor,
			taskKind: traceTaskKind,
			message: "new-api assets were not persisted into object storage",
			mode: "sync",
		});
		throw new AppError("new-api 生成结果未完成 OSS 托管，拒绝返回第三方 URL", {
			status: 502,
			code: "new_api_asset_hosting_required",
			details: {
				vendor: traceVendor,
				taskKind: traceTaskKind,
				taskId: meta.taskId,
				unhostedAssetCount: unhostedAssets.length,
				sampleUrls,
			},
		});
	}

	setTraceStage(c, "task:asset_hosting:done", {
		vendor: traceVendor,
		taskKind: traceTaskKind,
		hostedCount: hostedAssets.length,
		mode: "sync",
	});

	const rawRecord =
		typeof result.raw === "object" && result.raw !== null
			? (result.raw as Record<string, unknown>)
			: {};

	return TaskResultSchema.parse({
		...result,
		assets: hostedAssets,
		raw: {
			...rawRecord,
			hosting: {
				status: "ready",
				mode: "sync",
			},
		},
	});
}

async function releaseReservationOnThrow(
	c: AppContext,
	userId: string,
	reservation: TeamCreditsReservation,
	err: unknown,
): Promise<never> {
	if (reservation) {
		try {
			await releaseTeamCreditsOnFailure(c, userId, {
				taskId: reservation.reservationTaskId,
				taskKind: reservation.taskKind,
				vendor: reservation.vendor,
				modelKey: reservation.modelKey ?? null,
				specKey: reservation.specKey ?? null,
			});
		} catch {
			// ignore
		}
	}
	throw err;
}

async function bindReservationToTaskId(
	c: AppContext,
	userId: string,
	reservation: TeamCreditsReservation,
	taskId: string,
): Promise<void> {
	if (!reservation) return;
	const toTaskId = (taskId || "").trim();
	if (!toTaskId) return;
	try {
		await bindTeamCreditsReservationToTaskId(c, userId, {
			teamId: reservation.teamId,
			reservationTaskId: reservation.reservationTaskId,
			taskId: toTaskId,
		});
	} catch {
		// ignore
	}
}

function pickApiVendorForTask(
	result: TaskResult,
	fallbackVendor: string,
): string {
	const raw: any = result?.raw;
	const rawVendor = typeof raw?.vendor === "string" ? raw.vendor : "";
	const normalized = normalizeVendorKey(rawVendor);
	return normalized || fallbackVendor;
}

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

async function runTaskInWorkerBackground(
	c: AppContext,
	runInBackground: () => Promise<void>,
): Promise<void> {
	const execCtx = (c as any)?.executionCtx;
	if (execCtx && typeof execCtx.waitUntil === "function") {
		execCtx.waitUntil(runInBackground());
		return;
	}
	// Fallback (e.g. unit tests / non-worker runtimes): execute inline.
	await runInBackground();
}

export async function enqueueStoredTaskForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
	req: TaskRequestDto,
	options?: { taskId?: string | null },
): Promise<TaskResult> {
	const taskId = resolveStoredTaskId(options);
	const vendorKey = normalizeVendorKey(vendor);
	const nowIso = new Date().toISOString();
	const refKind = resolveStoredTaskRefKind(req.kind);

	const initial = buildStoredQueuedTaskResult({
		taskId,
		kind: req.kind,
		vendor: vendorKey,
		enqueuedAt: nowIso,
	});

	await persistStoredTaskResult(c, {
		userId,
		taskId,
		vendor: vendorKey,
		kind: req.kind,
		result: initial,
		nowIso,
	});

	await upsertStoredTaskRefSafely(c, {
		userId,
		refKind,
		taskId,
		vendor: vendorKey,
		nowIso,
		warnTag: "upsert async task ref failed",
	});

	// Make pending tasks visible in /tasks/logs immediately.
	await recordVendorCallPayloads(c, {
		userId,
		vendor: vendorKey,
		taskId,
		taskKind: req.kind,
		request: { vendor: vendorKey, request: req },
	});
	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: vendorKey,
		taskKind: req.kind,
		result: initial,
	});

	const runInBackground = async () => {
		const startedAtMs = Date.now();
		try {
			const startedIso = new Date().toISOString();
			const running = buildStoredRunningTaskResult({
				initial,
				startedAt: startedIso,
			});
			await persistStoredTaskResult(c, {
				userId,
				taskId,
				vendor: vendorKey,
				kind: req.kind,
				result: running,
				nowIso: startedIso,
			});
			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: vendorKey,
				taskKind: req.kind,
				result: running,
			});

			const final = await runGenericTaskForVendor(c, userId, vendorKey, req, {
				forceTaskId: taskId,
			});
			const completedAt =
				final.status === "succeeded" || final.status === "failed"
					? new Date().toISOString()
					: null;
			await persistStoredTaskResult(c, {
				userId,
				taskId,
				vendor: vendorKey,
				kind: req.kind,
				result: final,
				completedAt,
				nowIso: completedAt || new Date().toISOString(),
			});
		} catch (err: any) {
			const completedAt = new Date().toISOString();
			const failed = buildStoredFailedTaskResult({
				taskId,
				kind: req.kind,
				vendor: vendorKey,
				err,
			});

			try {
				await persistStoredTaskResult(c, {
					userId,
					taskId,
					vendor: vendorKey,
					kind: req.kind,
					result: failed,
					completedAt,
					nowIso: completedAt,
				});
			} catch (persistErr: any) {
				console.warn(
					"[task-store] persist async failure failed",
					persistErr?.message || persistErr,
				);
			}

			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: vendorKey,
				taskKind: req.kind,
				result: failed,
				durationMs: Date.now() - startedAtMs,
			});
		}
	};

	await runTaskInWorkerBackground(c, runInBackground);

	return initial;
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
		const rows = await getPrismaClient().proxy_providers.findMany({
			where: { owner_id: userId, vendor: key, enabled: 1 },
		});
		if (rows.length) {
			direct.push(...rows);
		}
	}

	// 2) Match via enabled_vendors JSON (recommended)
	const viaEnabled: ProxyProviderRow[] = [];
	for (const key of keys) {
		const rows = await getPrismaClient().proxy_providers.findMany({
			where: {
				owner_id: userId,
				enabled: 1,
				enabled_vendors: {
					not: null,
					contains: `"${key}"`,
				},
			},
		});
		if (rows.length) {
			viaEnabled.push(...rows);
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

	const readRoutingTaskKind = (): string | null => {
		try {
			const kind = c.get("routingTaskKind");
			return typeof kind === "string" && kind.trim() ? kind.trim() : null;
		} catch {
			return null;
		}
	};

	const readProxyDisabled = (): boolean => {
		try {
			return c.get("proxyDisabled") === true;
		} catch {
			return false;
		}
	};

	const readProxyVendorHint = (): string | null => {
		try {
			const hint = c.get("proxyVendorHint");
			return typeof hint === "string" && hint.trim()
				? hint.trim().toLowerCase()
				: null;
		} catch {
			return null;
		}
	};

	const isPublicApiRequest = (): boolean => {
		try {
			if (c.get("publicApi") === true) return true;
			const apiKeyId = c.get("apiKeyId");
			return typeof apiKeyId === "string" && !!apiKeyId.trim();
		} catch {
			return false;
		}
	};

	const parseEpoch = (iso?: string | null) => {
		if (!iso || typeof iso !== "string") return 0;
		const t = Date.parse(iso);
		return Number.isFinite(t) ? t : 0;
	};

	const proxyVendorHint = readProxyVendorHint();
	const candidates = (() => {
		// Public API calls: ignore misconfigured proxies and fall back to direct providers.
		if (!isPublicApiRequest()) return all;
		const eligible = all.filter((p) => {
			const baseUrl = normalizeBaseUrl((p as any).base_url);
			const apiKey = typeof (p as any).api_key === "string" ? (p as any).api_key.trim() : "";
			return !!baseUrl && !!apiKey;
		});
		return eligible;
	})();
	if (!candidates.length) return null;

	if (proxyVendorHint) {
		const matched = candidates.find(
			(p) => (p.vendor || "").trim().toLowerCase() === proxyVendorHint,
		);
		if (matched) return matched;
	}

	// Public API: prefer higher-success proxies when multiple are enabled.
	if (isPublicApiRequest() && candidates.length > 1 && !readProxyDisabled()) {
		const taskKind = readRoutingTaskKind();
		const isVideoTaskKind =
			taskKind === "text_to_video" || taskKind === "image_to_video";
		const sinceIso = !isVideoTaskKind
			? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
			: null;

		const scoreProxy = async (proxyVendor: string) => {
			const vkey = (proxyVendor || "").trim().toLowerCase();
			if (!vkey) {
				return {
					vendor: proxyVendor,
					success: 0,
					total: 0,
					rate: 0,
					avgMs: Number.POSITIVE_INFINITY,
				};
			}
			try {
				await ensureVendorCallLogsSchema(c.env.DB);
				const rows = await getPrismaClient().vendor_api_call_logs.findMany({
					where: {
						user_id: userId,
						vendor: vkey,
						status: { in: ["succeeded", "failed"] },
						finished_at: {
							...(sinceIso ? { gte: sinceIso } : {}),
							not: null,
						},
						...(taskKind ? { task_kind: taskKind } : {}),
					},
					select: { status: true, duration_ms: true },
				});
				const total = rows.length;
				const success = rows.filter((row) => row.status === "succeeded").length;
				// Laplace smoothing to avoid 0/0 and reduce cold-start noise
				const rate = (success + 1) / (total + 2);
				const durations = rows
					.filter((row) => row.status === "succeeded")
					.map((row) => row.duration_ms)
					.filter(
						(duration): duration is number =>
							typeof duration === "number" && Number.isFinite(duration),
					);
				const avgMs =
					durations.length > 0
						? durations.reduce((sum, duration) => sum + duration, 0) /
							durations.length
						: Number.POSITIVE_INFINITY;
				return { vendor: proxyVendor, success, total, rate, avgMs };
			} catch {
				return {
					vendor: proxyVendor,
					success: 0,
					total: 0,
					rate: 0,
					avgMs: Number.POSITIVE_INFINITY,
				};
			}
		};

		const scored = await Promise.all(
			candidates.map(async (p) => {
				const stat = await scoreProxy(p.vendor);
				return { proxy: p, ...stat };
			}),
		);

		if (isVideoTaskKind) {
			const MIN_CALLS_PER_VENDOR = 100;
			const isWarm = scored.every((s) => s.total >= MIN_CALLS_PER_VENDOR);

			const randomInt = (maxExclusive: number) => {
				const max = Math.max(0, Math.floor(maxExclusive));
				if (max <= 1) return 0;
				const buf = new Uint32Array(1);
				crypto.getRandomValues(buf);
				return buf[0]! % max;
			};

			if (!isWarm) {
				const idx = randomInt(candidates.length);
				return candidates[idx]!;
			}

			const best = scored.sort((a, b) => {
				if (b.rate !== a.rate) return b.rate - a.rate;
				if (a.avgMs !== b.avgMs) return a.avgMs - b.avgMs;
				if (b.total !== a.total) return b.total - a.total;
				const bt = parseEpoch(b.proxy.updated_at) || parseEpoch(b.proxy.created_at);
				const at = parseEpoch(a.proxy.updated_at) || parseEpoch(a.proxy.created_at);
				return bt - at;
			})[0];
			if (best?.proxy) return best.proxy;
		} else {
			const best = scored.sort((a, b) => {
				if (b.rate !== a.rate) return b.rate - a.rate;
				if (b.total !== a.total) return b.total - a.total;
				const bt = parseEpoch(b.proxy.updated_at) || parseEpoch(b.proxy.created_at);
				const at = parseEpoch(a.proxy.updated_at) || parseEpoch(a.proxy.created_at);
				return bt - at;
			})[0];
			if (best?.proxy) return best.proxy;
		}
	}

	// Default: prefer most recently updated proxy config to make vendor switching predictable
	return [...candidates].sort((a, b) => {
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
	const proxyDisabled = (() => {
		try {
			return c.get("proxyDisabled") === true;
		} catch {
			return false;
		}
	})();
	const proxy = proxyDisabled ? null : await resolveProxyForVendor(c, userId, v);
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
	const providers = await getPrismaClient().model_providers.findMany({
		where: { owner_id: userId, vendor: v },
		orderBy: { created_at: "asc" },
	});

	let provider: ProviderRow | null = providers[0] ?? null;
	let sharedTokenProvider: ProviderRow | null = null;
	let apiKey = "";

	let userConfigured = hasUserProxy;

	if (requiresApiKeyForVendor(v)) {
		let token: TokenRow | null = null;

		// 2.1 优先使用当前用户在该 Provider 下的 Token（自己配置优先）
		if (provider) {
			token = await getPrismaClient().model_tokens.findFirst({
				where: {
					provider_id: provider.id,
					user_id: userId,
					enabled: 1,
				},
				orderBy: { created_at: "asc" },
			});

			// 2.2 若没有自己的 Token，尝试该 Provider 下的共享 Token
			if (!token) {
				const nowIso = new Date().toISOString();
				token = await getPrismaClient().model_tokens.findFirst({
					where: {
						provider_id: provider.id,
						shared: 1,
						enabled: 1,
						OR: [
							{ shared_disabled_until: null },
							{ shared_disabled_until: { lt: nowIso } },
						],
					},
					orderBy: { updated_at: "asc" },
				});
			}

			if (token && typeof token.secret_token === "string") {
				apiKey = token.secret_token.trim();
				userConfigured = true;
			}
		}

		// 2.3 System-level vendor API key（admin 全局配置，优先于 env/shared token）
		if (!apiKey && !userConfigured) {
			const sys = await resolveSystemVendorApiKeyContext(c, v);
			if (sys && sys.enabled && sys.vendorEnabled) {
				let baseUrl =
					normalizeBaseUrl(sys.baseUrlHint || "") ||
					normalizeBaseUrl(defaultBaseUrlForVendor(v) || "");
				if (!baseUrl) {
					throw new AppError(`No base URL configured for vendor ${v}`, {
						status: 400,
						code: "base_url_missing",
					});
				}
				return { baseUrl, apiKey: sys.apiKey };
			}
		}


		// 2.5 仍未拿到，则从任意用户的共享 Token 中为该 vendor 选择一个（全局共享池）
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

	// 2.3b System-level vendor API key（admin 全局配置；支持动态 vendor key）
	// For vendors outside the hard-coded list, allow running purely based on model-catalog vendor config.
	if (!requiresApiKeyForVendor(v) && !userConfigured) {
		const sys = await resolveSystemVendorApiKeyContext(c, v);
		if (sys && sys.enabled && sys.vendorEnabled) {
			const baseUrl = normalizeBaseUrl(sys.baseUrlHint || "");
			if (!baseUrl) {
				throw new AppError(`No base URL configured for vendor ${v}`, {
					status: 400,
					code: "base_url_missing",
				});
			}
			return { baseUrl, apiKey: sys.apiKey };
		}
	}

	// 2.6 若用户自己没有 Provider，但通过共享 Token 找到了 Provider，则使用该 Provider
	if (!provider && sharedTokenProvider) {
		provider = sharedTokenProvider;
	}

	if (!provider) {
		throw new AppError(`No provider configured for vendor ${v}`, {
			status: 400,
			code: "provider_not_configured",
		});
	}

	// 2.8 解析 baseUrl：优先 Provider.base_url，其次 shared_base_url，其次系统级 vendor base_url_hint / 默认值
	let baseUrl = normalizeBaseUrl(provider.base_url || (await resolveSharedBaseUrl(c, v)) || "");

	if (!baseUrl && v === "veo") {
		baseUrl = normalizeBaseUrl("https://api.grsai.com");
	}

	if (!baseUrl) {
		const hint = await resolveSystemVendorBaseUrlHint(c, v);
		baseUrl =
			normalizeBaseUrl(hint || "") || normalizeBaseUrl(defaultBaseUrlForVendor(v) || "");
	}

	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}

	if (v === "gemini") {
		baseUrl = normalizeGeminiBaseUrl(baseUrl);
	}

	return { baseUrl, apiKey };
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
	const { baseUrl, apiKey } = resolveRequiredVendorHttpContext(ctx, {
		errorMessage: "comfly 代理未配置 Host 或 API Key",
		errorCode: "comfly_proxy_misconfigured",
	});

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

	emitProgress(userId, progressCtx, { status: "running", progress: 5 });
	const { response: res, data } = await fetchJsonWithDebug(c, {
		url: `${baseUrl}/v2/videos/generations`,
		init: {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		},
		tag: "comfly:videos:create",
		requestFailedMessage: "comfly 视频任务创建失败",
		requestFailedCode: "comfly_request_failed",
	});

	if (!res.ok) {
		const msg = extractUpstreamErrorMessage(
			data,
			`comfly 视频任务创建失败：${res.status}`,
		);
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
	const { baseUrl, apiKey } = resolveRequiredVendorHttpContext(ctx, {
		errorMessage: "comfly 代理未配置 Host 或 API Key",
		errorCode: "comfly_proxy_misconfigured",
	});

	const { response: res, data } = await fetchJsonWithDebug(c, {
		url: `${baseUrl}/v2/videos/generations/${encodeURIComponent(taskId.trim())}`,
		init: {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		},
		tag: "comfly:videos:result",
		requestFailedMessage: "comfly 结果查询失败",
		requestFailedCode: "comfly_result_failed",
	});

	if (!res.ok) {
		const msg = extractUpstreamErrorMessage(
			data,
			`comfly result poll failed: ${res.status}`,
		);
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
						model:
							typeof (data as any)?.model === "string"
								? (data as any).model
								: undefined,
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
					model:
						typeof (data as any)?.model === "string"
							? (data as any).model
							: undefined,
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
				vendor: metaVendor,
				model:
					typeof (data as any)?.model === "string"
						? (data as any).model
						: undefined,
				response: data ?? null,
				progress,
			},
		});
	}

	const assets = urls.map((url) =>
		TaskAssetSchema.parse({ type: "video", url, thumbnailUrl: null }),
	);

		const stagedAssets = await stageTaskAssetsForAsyncHosting({
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
			assets: stagedAssets,
			raw: {
				provider: "comfly",
				vendor: metaVendor,
				model:
					typeof (data as any)?.model === "string"
						? (data as any).model
						: undefined,
				response: data ?? null,
				hosting: { status: "pending", mode: "async" },
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

export function convertMessagesToResponsesInput(
	messages: OpenAIChatMessageForTask[],
) {
	return messages.map((msg) => ({
		role: msg.role,
		content: normalizeMessageContentForResponses(
			msg.content,
		).map(convertPartForResponses),
	}));
}

function asOpenAIRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readOpenAIString(record: Record<string, unknown> | null, key: string): string {
	if (!record) return "";
	const raw = record[key];
	return typeof raw === "string" ? raw.trim() : "";
}

function readOpenAIRawString(record: Record<string, unknown> | null, key: string): string {
	if (!record) return "";
	const raw = record[key];
	return typeof raw === "string" ? raw : "";
}

function collectOpenAIContentText(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const part of content) {
		const partRecord = asOpenAIRecord(part);
		if (!partRecord) continue;
		const text =
			readOpenAIString(partRecord, "text") ||
			readOpenAIString(partRecord, "content") ||
			readOpenAIString(partRecord, "output_text");
		if (text) out.push(text);
	}
	return out;
}

export function extractTextFromOpenAIResponseForTask(raw: unknown): string {
	const root = asOpenAIRecord(raw);
	if (!root) return "";

	// 兼容传统 chat.completions 结构
	const choices = root.choices;
	if (Array.isArray(choices)) {
		const choice = asOpenAIRecord(choices[0]);
		const message = asOpenAIRecord(choice?.message);
		const contentText = collectOpenAIContentText(message?.content).join("").trim();
		if (contentText) {
			return contentText;
		}
	}

	const outputText = readOpenAIString(root, "output_text");
	if (outputText) return outputText;

	if (Array.isArray(root.output_text)) {
		const merged = root.output_text
			.filter((value): value is string => typeof value === "string")
			.join("")
			.trim();
		if (merged) return merged;
	}

	// 兼容 responses 格式：output[].content[].text / output_text / content
	const output = root.output;
	if (Array.isArray(output)) {
		const buffer: string[] = [];
		for (const entry of output) {
			const entryRecord = asOpenAIRecord(entry);
			if (!entryRecord) continue;
			const entryText = readOpenAIString(entryRecord, "text");
			if (entryText) buffer.push(entryText);
			buffer.push(...collectOpenAIContentText(entryRecord.content));
		}
		const merged = buffer.join("").trim();
		if (merged) return merged;
	}

	const text = readOpenAIString(root, "text");
	if (text) {
		return text;
	}

	return "";
}

type OpenAIResponsesStreamState = {
	response: Record<string, unknown> | null;
	error: unknown;
	deltaText: string[];
	doneText: string;
	eventCount: number;
};

function parseOpenAIResponsesStreamPayload(rawEvent: SseEventMessage): Record<string, unknown> | null {
	const payloadText = rawEvent.data.trim();
	if (!payloadText || payloadText === "[DONE]") return null;
	const payload = JSON.parse(payloadText) as unknown;
	const record = asOpenAIRecord(payload);
	if (!record) {
		throw new Error(`responses_stream_payload_not_object:${rawEvent.event}`);
	}
	return record;
}

function applyOpenAIResponsesStreamEvent(
	state: OpenAIResponsesStreamState,
	rawEvent: SseEventMessage,
): void {
	const payload = parseOpenAIResponsesStreamPayload(rawEvent);
	if (!payload) return;
	state.eventCount += 1;

	const eventType = readOpenAIString(payload, "type") || rawEvent.event;
	const response = asOpenAIRecord(payload.response);
	if (response) {
		state.response = response;
		if (response.error) {
			state.error = response.error;
		}
	}
	if (payload.error) {
		state.error = payload.error;
	}

	if (eventType === "response.output_text.delta") {
		const delta = readOpenAIRawString(payload, "delta");
		if (delta) state.deltaText.push(delta);
		return;
	}
	if (eventType === "response.output_text.done") {
		const text = readOpenAIRawString(payload, "text");
		if (text) state.doneText = text;
		return;
	}
	const outputText = readOpenAIRawString(payload, "output_text").trim();
	if (outputText) {
		state.doneText = outputText;
	}
}

function createOpenAIResponsesStreamState(): OpenAIResponsesStreamState {
	return {
		response: null,
		error: null,
		deltaText: [],
		doneText: "",
		eventCount: 0,
	};
}

function finalizeOpenAIResponsesStreamState(
	state: OpenAIResponsesStreamState,
): Record<string, unknown> {
	const base: Record<string, unknown> = state.response ? { ...state.response } : {};
	const text = state.doneText || state.deltaText.join("").trim() || extractTextFromOpenAIResponseForTask(base);
	if (text) {
		base.output_text = text;
	}
	if (state.error) {
		base.error = state.error;
	}
	base.stream_event_count = state.eventCount;
	return base;
}

export function parseOpenAIResponsesSseTextForTask(raw: string): Record<string, unknown> {
	const parser = createSseEventParser();
	const state = createOpenAIResponsesStreamState();
	for (const event of parser.push(raw)) {
		applyOpenAIResponsesStreamEvent(state, event);
	}
	for (const event of parser.finish()) {
		applyOpenAIResponsesStreamEvent(state, event);
	}
	return finalizeOpenAIResponsesStreamState(state);
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

export function canonicalizeNewApiModelKey(
	vendorKey: string,
	modelKey: string,
): string {
	const normalizedVendor = normalizeVendorKey(vendorKey);
	const trimmedModelKey = modelKey.trim();
	if (!trimmedModelKey) return "";
	if (normalizedVendor === "apimart" && trimmedModelKey.endsWith("-apimart")) {
		return trimmedModelKey.slice(0, -"-apimart".length);
	}
	return trimmedModelKey;
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

function resolveNewApiRelayConfig(c: AppContext): { baseUrl: string; token: string } | null {
	const read = (key: "NEW_API_INTERNAL_BASE_URL" | "NEW_API_INTERNAL_TOKEN"): string => {
		const envValue = typeof (c.env as any)?.[key] === "string" ? String((c.env as any)[key]) : "";
		if (envValue.trim()) return envValue.trim();
		const processValue =
			typeof (globalThis as any)?.process?.env?.[key] === "string"
				? String((globalThis as any).process.env[key]).trim()
				: "";
		return processValue;
	};

	const baseUrl = normalizeBaseUrl(read("NEW_API_INTERNAL_BASE_URL"));
	const token = read("NEW_API_INTERNAL_TOKEN");
	if (!baseUrl || !token) return null;
	return { baseUrl, token };
}

function buildNewApiV1Url(baseUrl: string, path: string): string {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	const trimmedPath = path.replace(/^\/+/, "");
	return new URL(trimmedPath, `${normalizedBaseUrl}/`).toString();
}

function buildNewApiImageSize(req: TaskRequestDto): string | undefined {
	if (
		typeof req.width === "number" &&
		Number.isFinite(req.width) &&
		req.width > 0 &&
		typeof req.height === "number" &&
		Number.isFinite(req.height) &&
		req.height > 0
	) {
		return `${Math.round(req.width)}x${Math.round(req.height)}`;
	}
	return undefined;
}

function normalizeCompactString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.replace(/\s+/g, "");
}

function parseAspectRatioValue(value: string): { width: number; height: number } | null {
	const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}
	return { width, height };
}

function inferAspectRatioFromDimensions(
	width: number,
	height: number,
	supported: string[],
): string | null {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}
	const target = width / height;
	let best: { value: string; delta: number } | null = null;
	for (const item of supported) {
		const parsed = parseAspectRatioValue(item);
		if (!parsed) continue;
		const delta = Math.abs(target - parsed.width / parsed.height);
		if (!best || delta < best.delta) {
			best = { value: item, delta };
		}
	}
	return best && best.delta <= 0.03 ? best.value : null;
}

type NewApiImageRequestShape = {
	size?: string;
	resolution?: string;
	quality?: string;
	metadata?: Record<string, unknown>;
};

function normalizeImageBillingSpecSegment(value: string | null | undefined): string | null {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!raw) return null;
	const normalized = raw.replace(/:/g, "_").replace(/[^a-z0-9_-]+/g, "_");
	return normalized.replace(/^_+|_+$/g, "") || null;
}

function buildImageBillingSpecKey(shape: NewApiImageRequestShape): string | null {
	const aspectRatio =
		typeof shape.metadata?.aspectRatio === "string"
			? normalizeImageBillingSpecSegment(shape.metadata.aspectRatio)
			: null;
	const resolution = normalizeImageBillingSpecSegment(
		shape.resolution ||
			(typeof shape.metadata?.imageSize === "string" ? shape.metadata.imageSize : null) ||
			shape.size,
	);
	if (!resolution) return null;
	const quality = normalizeImageBillingSpecSegment(shape.quality);
	return ["image", aspectRatio, resolution, quality].filter(Boolean).join(":");
}

function isGptImage2OfficialModel(modelKey: string | null | undefined): boolean {
	return typeof modelKey === "string" && modelKey.trim().toLowerCase() === "gpt-image-2-official";
}

function isRichOfficialImageBillingSpecKey(specKey: string | null | undefined): boolean {
	const parts = typeof specKey === "string" ? specKey.trim().toLowerCase().split(":") : [];
	return (
		parts.length === 4 &&
		parts[0] === "image" &&
		Boolean(parts[1]) &&
		/^(?:1k|2k|4k)$/.test(parts[2] || "") &&
		/^(?:auto|low|medium|high)$/.test(parts[3] || "")
	);
}

function buildNewApiImageRequestShape(input: {
	req: TaskRequestDto;
	imageOptions?: {
		aspectRatioOptions: string[];
		imageSizeOptions: string[];
		resolutionOptions: string[];
		qualityOptions: string[];
		defaultAspectRatio?: string;
		defaultResolution?: string;
		defaultQuality?: string;
	} | null;
}): NewApiImageRequestShape {
	const { req, imageOptions } = input;
	const extras = (req.extras || {}) as Record<string, unknown>;
	const pixelSize = buildNewApiImageSize(req);
	const supportedAspectRatios = Array.isArray(imageOptions?.aspectRatioOptions)
		? imageOptions.aspectRatioOptions
				.map((item) => normalizeCompactString(item))
				.filter((item): item is string => Boolean(item))
		: [];
	const supportedImageSizes = Array.isArray(imageOptions?.imageSizeOptions)
		? imageOptions.imageSizeOptions
				.map((item) => normalizeCompactString(item))
				.filter((item): item is string => Boolean(item))
		: [];
	const supportedResolutions = Array.isArray(imageOptions?.resolutionOptions)
		? imageOptions.resolutionOptions
				.map((item) => normalizeCompactString(item))
				.filter((item): item is string => Boolean(item))
		: [];
	const supportedQualities = Array.isArray(imageOptions?.qualityOptions)
		? imageOptions.qualityOptions
				.map((item) => normalizeCompactString(item))
				.filter((item): item is string => Boolean(item))
		: [];

	const explicitAspectRatioCandidates = [
		normalizeCompactString(extras.aspectRatio),
		normalizeCompactString(extras.aspect_ratio),
		normalizeCompactString(extras.size),
	];
	const explicitAspectRatio =
		normalizeCompactString(extras.aspectRatio) ||
		normalizeCompactString(extras.aspect_ratio);
	const explicitImageSizeCandidates = [
		normalizeCompactString(extras.imageSize),
		normalizeCompactString(extras.image_size),
		normalizeCompactString(extras.size),
		pixelSize,
	];
	const explicitImageSize =
		normalizeCompactString(extras.imageSize) ||
		normalizeCompactString(extras.image_size) ||
		pixelSize;

	const pickedAspectRatioExplicit =
		(supportedAspectRatios.length > 0
			? supportedAspectRatios.find((option) => explicitAspectRatioCandidates.includes(option))
			: explicitAspectRatio) ||
		(pixelSize ? inferAspectRatioFromDimensions(req.width || 0, req.height || 0, supportedAspectRatios) : null);
	// When model has aspectRatioOptions but no explicit ratio was given, fall back to defaultAspectRatio
	// to prevent imageSize values like "2K" from being sent as the size parameter to the upstream.
	const pickedAspectRatio =
		pickedAspectRatioExplicit ||
		(supportedAspectRatios.length > 0
			? (normalizeCompactString(imageOptions?.defaultAspectRatio) ?? supportedAspectRatios[0] ?? null)
			: null);
	const pickedImageSize =
		(supportedImageSizes.length > 0
			? supportedImageSizes.find((option) => explicitImageSizeCandidates.includes(option))
			: explicitImageSize) || null;

	const rawResolution = normalizeCompactString(extras.resolution)?.toLowerCase() ?? null;
	const pickedResolution = rawResolution
		? (supportedResolutions.length > 0
			? (supportedResolutions.find((r) => r.toLowerCase() === rawResolution) ?? null)
			: rawResolution)
		: (imageOptions?.defaultResolution ??
			(pickedImageSize && (supportedResolutions.length === 0 || supportedResolutions.includes(pickedImageSize))
				? pickedImageSize
				: null));

	const rawQuality = normalizeCompactString(extras.quality)?.toLowerCase() ?? null;
	const pickedQuality = rawQuality
		? (supportedQualities.length > 0
			? (supportedQualities.find((q) => q.toLowerCase() === rawQuality) ?? null)
			: rawQuality)
		: (imageOptions?.defaultQuality ?? null);

	const shape: NewApiImageRequestShape = {};

	if (pickedAspectRatio) {
		const metadata: Record<string, unknown> = { aspectRatio: pickedAspectRatio };
		if (pickedImageSize) {
			metadata.imageSize = pickedImageSize;
		}
		shape.size = pickedAspectRatio;
		shape.metadata = metadata;
	} else if (pickedImageSize) {
		shape.size = pickedImageSize;
		shape.metadata = { imageSize: pickedImageSize };
	} else if (pixelSize) {
		shape.size = pixelSize;
	}

	if (pickedResolution) {
		shape.resolution = pickedResolution;
	}
	if (pickedQuality) {
		shape.quality = pickedQuality;
	}

	return shape;
}

async function resolveNewApiImageOptions(
	c: AppContext,
	vendorKey: string,
	modelKey: string,
): Promise<{
	aspectRatioOptions: string[];
	imageSizeOptions: string[];
	resolutionOptions: string[];
	qualityOptions: string[];
	defaultAspectRatio?: string;
	defaultResolution?: string;
	defaultQuality?: string;
} | null> {
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const row = await getPrismaClient().model_catalog_models.findUnique({
			where: {
				vendor_key_model_key: {
					vendor_key: vendorKey,
					model_key: modelKey,
				},
			},
			select: {
				meta: true,
			},
		});
		if (typeof row?.meta !== "string" || !row.meta.trim()) return null;
		const parsed: unknown = JSON.parse(row.meta);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
		const metaRecord = parsed as Record<string, unknown>;
		const imageOptionsRaw = metaRecord.imageOptions;
		const imageOptionsParsed = ModelCatalogImageOptionsSchema.safeParse(imageOptionsRaw);
		if (!imageOptionsParsed.success) return null;
		const data = imageOptionsParsed.data;
		return {
			aspectRatioOptions: data.aspectRatioOptions,
			imageSizeOptions: data.imageSizeOptions.map((item) =>
				typeof item === "string" ? item : item.value,
			),
			resolutionOptions: data.resolutionOptions.map((item) =>
				typeof item === "string" ? item : item.value,
			),
			qualityOptions: data.qualityOptions,
			...(data.defaultAspectRatio ? { defaultAspectRatio: data.defaultAspectRatio } : {}),
			...(data.defaultResolution ? { defaultResolution: data.defaultResolution } : {}),
			...(data.defaultQuality ? { defaultQuality: data.defaultQuality } : {}),
		};
	} catch {
		return null;
	}
}

export type NewApiVideoRequestShape = {
	size?: string;
	resolution?: string;
	aspectRatio?: string;
};

export function buildNewApiVideoRequestShape(
	_vendorKey: string,
	req: TaskRequestDto,
): NewApiVideoRequestShape {
	const extras = (req.extras || {}) as Record<string, unknown>;
	const rawSize =
		typeof extras.size === "string" && extras.size.trim()
			? extras.size.trim()
			: "";
	const rawResolution =
		typeof extras.resolution === "string" && extras.resolution.trim()
			? extras.resolution.trim()
			: "";
	const rawAspectRatio =
		typeof extras.aspectRatio === "string" && extras.aspectRatio.trim()
			? extras.aspectRatio.trim()
			: "";
	const explicitPixelSize =
		typeof req.width === "number" &&
		Number.isFinite(req.width) &&
		req.width > 0 &&
		typeof req.height === "number" &&
		Number.isFinite(req.height) &&
		req.height > 0
			? `${Math.round(req.width)}x${Math.round(req.height)}`
			: "";

	return {
		...(rawSize ? { size: rawSize } : explicitPixelSize ? { size: explicitPixelSize } : {}),
		...(rawResolution ? { resolution: rawResolution } : {}),
		...(rawAspectRatio ? { aspectRatio: rawAspectRatio } : {}),
	};
}

export function isDirectNewApiVideoReferenceUrl(raw: string): boolean {
	const ref = String(raw || "").trim();
	return /^https?:\/\//i.test(ref);
}

async function resolveNewApiImageFilePart(
	c: AppContext,
	raw: string,
	fieldLabel: "image" | "mask",
): Promise<{ blob: Blob; filename: string; contentType: string; source: string }> {
	const ref = String(raw || "").trim();
	if (!ref) {
		throw new AppError(`new-api ${fieldLabel} 为空`, {
			status: 400,
			code: `new_api_${fieldLabel}_empty`,
		});
	}
	if (/^blob:/i.test(ref)) {
		throw new AppError(`new-api ${fieldLabel} 不支持 blob: URL，请先上传为可访问的图片地址`, {
			status: 400,
			code: `new_api_${fieldLabel}_invalid`,
		});
	}

	const dataUrlMatch = ref.match(/^data:([^;]+);base64,(.+)$/i);
	if (dataUrlMatch) {
		const contentType = normalizeMimeType(dataUrlMatch[1]) || "application/octet-stream";
		if (!isSupportedImageMimeType(contentType)) {
			throw new AppError(
				`new-api ${fieldLabel} 文件类型不受支持: ${contentType}。仅支持 image/jpeg、image/png、image/webp`,
				{
					status: 400,
					code: `new_api_${fieldLabel}_invalid_mime`,
					details: { contentType, source: ref.slice(0, 160) },
				},
			);
		}
		const bytes = decodeBase64ToBytes((dataUrlMatch[2] || "").trim());
		const ext = detectImageExtensionFromMimeType(contentType);
		return {
			blob: new Blob([new Uint8Array(bytes)], { type: contentType }),
			filename: `${fieldLabel}.${ext || "bin"}`,
			contentType,
			source: ref.slice(0, 64),
		};
	}

	const resolvedRef = ref.startsWith("/")
		? new URL(ref, new URL(c.req.url).origin).toString()
		: ref;
	if (!/^https?:\/\//i.test(resolvedRef)) {
		throw new AppError(`new-api ${fieldLabel} 仅支持 http(s) URL 或 data:image/*;base64`, {
			status: 400,
			code: `new_api_${fieldLabel}_invalid`,
			details: { source: ref.slice(0, 160) },
		});
	}

	let res: Response;
	try {
		res = await fetchWithHttpDebugLog(
			c,
			resolvedRef,
			{ method: "GET", headers: { Accept: "image/*,*/*;q=0.8" } },
			{ tag: `newapi:${fieldLabel}:fetch` },
		);
	} catch (error: any) {
		throw new AppError(`new-api ${fieldLabel} 下载失败`, {
			status: 502,
			code: `new_api_${fieldLabel}_fetch_failed`,
			details: { message: error?.message ?? String(error), source: resolvedRef.slice(0, 160) },
		});
	}
	if (!res.ok) {
		throw new AppError(`new-api ${fieldLabel} 下载失败: ${res.status}`, {
			status: 502,
			code: `new_api_${fieldLabel}_fetch_failed`,
			details: { upstreamStatus: res.status, source: resolvedRef.slice(0, 160) },
		});
	}

	const contentType =
		normalizeMimeType(res.headers.get("content-type")) || "application/octet-stream";
	if (!isSupportedImageMimeType(contentType)) {
		throw new AppError(
			`new-api ${fieldLabel} 文件类型不受支持: ${contentType}。仅支持 image/jpeg、image/png、image/webp`,
			{
				status: 400,
				code: `new_api_${fieldLabel}_invalid_mime`,
				details: { contentType, source: resolvedRef.slice(0, 160) },
			},
		);
	}

	const buf = await res.arrayBuffer();
	const extFromUrl = (() => {
		try {
			const pathname = new URL(resolvedRef).pathname || "";
			const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
			return match && match[1] ? match[1].toLowerCase() : null;
		} catch {
			return null;
		}
	})();
	const ext = extFromUrl || detectImageExtensionFromMimeType(contentType);
	return {
		blob: new Blob([buf], { type: contentType }),
		filename: `${fieldLabel}.${ext || "bin"}`,
		contentType,
		source: resolvedRef,
	};
}

export function resolveTaskMaskUrl(extras: Record<string, unknown>): string | null {
	const directMaskUrl =
		typeof extras.maskUrl === "string" && extras.maskUrl.trim()
			? extras.maskUrl.trim()
			: typeof extras.mask_url === "string" && extras.mask_url.trim()
				? extras.mask_url.trim()
				: "";
	if (directMaskUrl) return directMaskUrl;

	const assetInputs = Array.isArray(extras.assetInputs) ? extras.assetInputs : [];
	for (const item of assetInputs) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
		if (role !== "mask") continue;
		const url = typeof record.url === "string" ? record.url.trim() : "";
		if (url) return url;
	}
	return null;
}

export function buildNewApiImageGenerationBody(input: {
	model: string;
	prompt: string;
	size?: string;
	resolution?: string;
	quality?: string;
	metadata?: Record<string, unknown>;
	negativePrompt?: string;
	seed?: number;
	referenceImages?: string[];
	responseModalities?: string[];
	user?: string;
}): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: input.model,
		prompt: input.prompt,
		n: 1,
		response_format: "url",
	};
	if (input.user) {
		body.user = input.user;
	}
	if (input.size) {
		body.size = input.size;
	}
	if (input.resolution) {
		body.resolution = input.resolution;
	}
	if (input.quality) {
		body.quality = input.quality;
	}
	const baseMetadata = input.metadata && Object.keys(input.metadata).length > 0
		? input.metadata
		: null;
	if (Array.isArray(input.responseModalities) && input.responseModalities.length > 0) {
		// Pass response_modalities at top level so new-api can honour it directly,
		// and also inside metadata.generationConfig for adapters that read it there.
		body.response_modalities = input.responseModalities;
		body.metadata = {
			...(baseMetadata ?? {}),
			generationConfig: { responseModalities: input.responseModalities },
		};
	} else if (baseMetadata) {
		body.metadata = baseMetadata;
	}
	// imageSize is nested inside metadata, but some new-api adaptors (magic666, doubao, etc.)
	// look for it at the top level of Extra. Flatten it so both paths find it.
	if (typeof baseMetadata?.imageSize === "string" && baseMetadata.imageSize) {
		body.imageSize = baseMetadata.imageSize;
	}
	if (typeof input.negativePrompt === "string" && input.negativePrompt.trim()) {
		body.negative_prompt = input.negativePrompt.trim();
	}
	if (typeof input.seed === "number" && Number.isFinite(input.seed)) {
		body.seed = Math.trunc(input.seed);
	}
	if (Array.isArray(input.referenceImages) && input.referenceImages.length > 0) {
		body.images = input.referenceImages;
	}
	return body;
}

// Gemini native image models (Nano Banana family) support multimodal output.
// They are routed through /v1/images/generations in new-api but can return
// text when responseModalities includes "TEXT".
export function isGeminiNativeImageModel(modelKey: string): boolean {
	return /gemini[^a-z0-9]*(?:.*?\b(?:flash|pro)\b.*?image|.*?\bimage\b)/i.test(modelKey)
		|| /nano[-_]?banana/i.test(modelKey);
}

// Extract text from Gemini's generateContent response, which new-api surfaces
// either as OpenAI candidates passthrough or inside data[].revised_prompt.
export function extractTextFromGeminiImageGenResponse(data: unknown): string {
	if (!data || typeof data !== "object") return "";
	const payload = data as Record<string, unknown>;

	// Gemini native: candidates[].content.parts[].text
	const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
	for (const candidate of candidates) {
		const parts = Array.isArray((candidate as any)?.content?.parts)
			? (candidate as any).content.parts as unknown[]
			: [];
		for (const part of parts) {
			const text = (part as any)?.text;
			if (typeof text === "string" && text.trim()) return text.trim();
		}
	}

	// OpenAI-compat fallback: revised_prompt
	const rows = Array.isArray(payload.data) ? payload.data : [];
	for (const row of rows) {
		const rp = (row as any)?.revised_prompt;
		if (typeof rp === "string" && rp.trim()) return rp.trim();
	}
	return "";
}

export function collectTaskReferenceImageUrls(extras: Record<string, unknown>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const pushValue = (value: unknown) => {
		const items = Array.isArray(value) ? value : [value];
		for (const item of items) {
			if (typeof item !== "string") continue;
			const trimmed = item.trim();
			if (!trimmed || !/^https?:\/\//i.test(trimmed)) continue;
			if (seen.has(trimmed)) continue;
			seen.add(trimmed);
			out.push(trimmed);
		}
	};

	pushValue(extras.referenceImages);
	pushValue(extras.reference_images);
	pushValue(extras.imageUrl);
	pushValue(extras.image_url);
	pushValue(extras.imageUrls);
	pushValue(extras.image_urls);
	pushValue(extras.urls);
	pushValue(extras.image);
	pushValue(extras.url);
	pushValue(extras.firstFrameUrl);
	pushValue(extras.lastFrameUrl);
	return out;
}

export function extractNewApiImageAssets(payload: any): Array<ReturnType<typeof TaskAssetSchema.parse>> {
	const assets: Array<ReturnType<typeof TaskAssetSchema.parse>> = [];
	const seen = new Set<string>();
	const pushAsset = (url: string) => {
		const trimmed = typeof url === "string" ? url.trim() : "";
		if (!trimmed || seen.has(trimmed)) return;
		seen.add(trimmed);
		assets.push(
			TaskAssetSchema.parse({
				type: "image",
				url: trimmed,
				thumbnailUrl: null,
			}),
		);
	};
	const rows = Array.isArray(payload?.data) ? payload.data : [];
	for (const row of rows) {
		const url =
			typeof row?.url === "string" && row.url.trim()
				? row.url.trim()
				: typeof row?.b64_json === "string" && row.b64_json.trim()
					? `data:image/png;base64,${row.b64_json.trim()}`
					: "";
		if (!url) continue;
		pushAsset(url);
	}

	const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
	for (const candidate of candidates) {
		const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
		for (const part of parts) {
			const inline = part?.inlineData || part?.inline_data || null;
			if (inline && typeof inline === "object") {
				const base64 = typeof inline?.data === "string" ? inline.data.trim() : "";
				if (base64) {
					const mimeType =
						typeof inline?.mimeType === "string" && inline.mimeType.trim()
							? inline.mimeType.trim()
							: typeof inline?.mime_type === "string" && inline.mime_type.trim()
								? inline.mime_type.trim()
								: "image/png";
					pushAsset(`data:${mimeType};base64,${base64.replace(/\s+/g, "")}`);
				}
			}

			const fileData = part?.fileData || part?.file_data || null;
			if (fileData && typeof fileData === "object") {
				const fileUri =
					typeof fileData?.fileUri === "string" && fileData.fileUri.trim()
						? fileData.fileUri.trim()
						: typeof fileData?.file_uri === "string" && fileData.file_uri.trim()
							? fileData.file_uri.trim()
							: "";
				if (fileUri) pushAsset(fileUri);
			}
		}
	}
	return assets;
}

function pushNewApiVideoAssetUrl(urls: Set<string>, value: unknown) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	if (!trimmed) return;
	urls.add(trimmed);
}

export function extractNewApiVideoAssets(
	payload: unknown,
): Array<ReturnType<typeof TaskAssetSchema.parse>> {
	const urls = new Set<string>();
	const root = typeof payload === "object" && payload !== null ? payload : null;
	const maybeStrings = [
		root && "url" in root ? root.url : null,
		root && "video_url" in root ? root.video_url : null,
		root && "result_url" in root ? root.result_url : null,
		root && "metadata" in root && typeof root.metadata === "object" && root.metadata !== null
			? "url" in root.metadata
				? root.metadata.url
				: null
			: null,
		root && "content" in root && typeof root.content === "object" && root.content !== null
			? "video_url" in root.content
				? root.content.video_url
				: null
			: null,
		root && "output" in root && typeof root.output === "object" && root.output !== null
			? "url" in root.output
				? root.output.url
				: null
			: null,
		root && "output" in root && typeof root.output === "object" && root.output !== null
			? "video_url" in root.output
				? root.output.video_url
				: null
			: null,
		root && "data" in root && typeof root.data === "object" && root.data !== null
			? "url" in root.data
				? root.data.url
				: null
			: null,
		root && "data" in root && typeof root.data === "object" && root.data !== null
			? "video_url" in root.data
				? root.data.video_url
				: null
			: null,
		root && "data" in root && typeof root.data === "object" && root.data !== null
			? "content" in root.data &&
			  typeof root.data.content === "object" &&
			  root.data.content !== null &&
			  "video_url" in root.data.content
				? root.data.content.video_url
				: null
			: null,
		root && "response" in root && typeof root.response === "object" && root.response !== null
			? "result_url" in root.response
				? root.response.result_url
				: null
			: null,
		root && "response" in root && typeof root.response === "object" && root.response !== null
			? "metadata" in root.response &&
			  typeof root.response.metadata === "object" &&
			  root.response.metadata !== null &&
			  "url" in root.response.metadata
				? root.response.metadata.url
				: null
			: null,
	];
	for (const value of maybeStrings) {
		pushNewApiVideoAssetUrl(urls, value);
	}
	const dataRows =
		root && "data" in root && Array.isArray(root.data) ? root.data : [];
	for (const row of dataRows) {
		if (typeof row !== "object" || row === null) continue;
		pushNewApiVideoAssetUrl(urls, "url" in row ? row.url : null);
		pushNewApiVideoAssetUrl(urls, "video_url" in row ? row.video_url : null);
		if ("content" in row && typeof row.content === "object" && row.content !== null) {
			pushNewApiVideoAssetUrl(
				urls,
				"video_url" in row.content ? row.content.video_url : null,
			);
		}
	}
	return Array.from(urls).map((url) =>
		TaskAssetSchema.parse({
			type: "video",
			url,
			thumbnailUrl: null,
		}),
	);
}

function normalizeNewApiVideoStatus(value: unknown): "queued" | "running" | "succeeded" | "failed" {
	if (typeof value !== "string") return "running";
	const normalized = value.trim().toLowerCase();
	if (["succeeded", "success", "completed", "done"].includes(normalized)) {
		return "succeeded";
	}
	if (["failed", "error", "cancelled"].includes(normalized)) {
		return "failed";
	}
	if (["queued", "pending", "submitted"].includes(normalized)) {
		return "queued";
	}
	return "running";
}

async function resolveTaskModelKeyForNewApi(
	c: AppContext,
	vendorKey: string,
	req: TaskRequestDto,
): Promise<string> {
	const explicitModelKey = pickModelKey(req, { modelKey: undefined });
	if (explicitModelKey) {
		return canonicalizeNewApiModelKey(vendorKey, explicitModelKey);
	}
	const kindHint =
		req.kind === "chat" || req.kind === "prompt_refine" || req.kind === "image_to_prompt"
			? "text"
			: req.kind === "text_to_image" || req.kind === "image_edit"
				? "image"
				: "video";
	const fallback = await resolveDefaultModelKeyFromCatalogForVendor(c, vendorKey, kindHint);
	if (fallback) return canonicalizeNewApiModelKey(vendorKey, fallback);
	throw new AppError("未配置可用模型（extras.modelKey 为空，且模型目录没有默认模型）", {
		status: 400,
		code: "model_not_configured",
		details: { vendor: vendorKey, taskKind: req.kind },
	});
}

function resolveNewApiTaskModelKind(taskKind: TaskRequestDto["kind"]): "text" | "image" | "video" {
	if (taskKind === "chat" || taskKind === "prompt_refine" || taskKind === "image_to_prompt") {
		return "text";
	}
	if (taskKind === "text_to_image" || taskKind === "image_edit") {
		return "image";
	}
	return "video";
}

async function assertNewApiRouteEnabledForTask(
	c: AppContext,
	input: {
		vendorKey: string;
		modelKey: string;
		taskKind: TaskRequestDto["kind"];
	},
): Promise<void> {
	const vendorKey = normalizeVendorKey(input.vendorKey);
	const modelKey = input.modelKey.trim();
	if (!vendorKey || !modelKey) {
		throw new AppError("new-api 路由缺少厂商或模型", {
			status: 400,
			code: "new_api_route_invalid",
			details: {
				vendor: input.vendorKey,
				model: input.modelKey,
				taskKind: input.taskKind,
			},
		});
	}

	await ensureModelCatalogSchema(c.env.DB);
	// "newapi" and "auto" both mean "route via new-api automatically" — skip vendor DB lookup.
	if (vendorKey !== "newapi" && vendorKey !== "auto") {
		const vendorRow = await getPrismaClient().model_catalog_vendors.findUnique({
			where: { key: vendorKey },
			select: { enabled: true },
		});
		if (!vendorRow) {
			throw new AppError("模型厂商未配置，拒绝调用 new-api", {
				status: 400,
				code: "model_vendor_not_configured",
				details: { vendor: vendorKey, model: modelKey, taskKind: input.taskKind },
			});
		}
		if (Number(vendorRow.enabled ?? 0) === 0) {
			throw new AppError("模型厂商已停用，拒绝调用 new-api", {
				status: 400,
				code: "model_vendor_disabled",
				details: { vendor: vendorKey, model: modelKey, taskKind: input.taskKind },
			});
		}
	}

	const normalizedModelKey = normalizeBillingModelKey(modelKey);
	const kind = resolveNewApiTaskModelKind(input.taskKind);
	const enabledModels = await listNewApiModels(c.env, {
		enabled: true,
		kind,
		fresh: true,
	});
	const matched = enabledModels.some((model) => {
		const modelName = normalizeBillingModelKey(model.modelName);
		const requestModelKey = normalizeBillingModelKey(model.requestModelKey);
		return modelName === normalizedModelKey || requestModelKey === normalizedModelKey;
	});
	if (!matched) {
		throw new AppError("模型已停用或未出现在 new-api 启用列表中，拒绝调用上游", {
			status: 400,
			code: "new_api_model_disabled",
			details: {
				vendor: vendorKey,
				model: modelKey,
				taskKind: input.taskKind,
				kind,
			},
		});
	}
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function readNestedString(record: Record<string, unknown> | null, ...keys: string[]): string {
	let current: unknown = record;
	for (const key of keys) {
		const nextRecord = readRecord(current);
		if (!nextRecord) return "";
		current = nextRecord[key];
	}
	return typeof current === "string" ? current.trim() : "";
}

function classifyTaskUpstreamHttpError(input: {
	provider: string;
	status: number;
	data: unknown;
}): { status: number; code: string; message: string } | null {
	const payload = readRecord(input.data);
	const errorCode = readNestedString(payload, "error", "code").toLowerCase();
	const errorType = readNestedString(payload, "error", "type").toLowerCase();
	const errorMessage = readNestedString(payload, "error", "message").toLowerCase();
	const topLevelMessage = readNestedString(payload, "message").toLowerCase();
	const joined = [errorCode, errorType, errorMessage, topLevelMessage].filter(Boolean).join(" ");
	const isImageGenerationFailure =
		joined.includes("channel:image_generation_failed") ||
		joined.includes("gemini image generation failed") ||
		joined.includes("no_image");
	if (isImageGenerationFailure && input.status >= 400) {
		return {
			status: 502,
			code: `${input.provider}_image_generation_failed`,
			message: "图像生成失败，请稍后重试",
		};
	}
	return null;
}

async function readOpenAIResponsesSseResponseForTask(
	response: Response,
): Promise<Record<string, unknown>> {
	if (!response.body) {
		throw new Error("responses_stream_missing_body");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parser = createSseEventParser();
	const state = createOpenAIResponsesStreamState();

	while (true) {
		const readResult = await reader.read();
		if (readResult.done) break;
		const chunk = decoder.decode(readResult.value, { stream: true });
		for (const event of parser.push(chunk)) {
			applyOpenAIResponsesStreamEvent(state, event);
		}
	}
	const trailing = decoder.decode();
	if (trailing) {
		for (const event of parser.push(trailing)) {
			applyOpenAIResponsesStreamEvent(state, event);
		}
	}
	for (const event of parser.finish()) {
		applyOpenAIResponsesStreamEvent(state, event);
	}
	return finalizeOpenAIResponsesStreamState(state);
}

async function readResponseTextForTask(res: Response): Promise<string> {
	try {
		return await res.text();
	} catch {
		return "";
	}
}

async function callOpenAIResponsesStreamApi(
	c: AppContext,
	url: string,
	init: RequestInit,
	errorContext: { provider: string; requestPayload?: unknown },
): Promise<Record<string, unknown>> {
	const startedAt = Date.now();
	const safeUrl = (() => {
		try {
			const parsed = new URL(url);
			return `${parsed.origin}${parsed.pathname}`;
		} catch {
			return url;
		}
	})();
	const method =
		typeof init?.method === "string" && init.method.trim()
			? init.method.trim().toUpperCase()
			: null;

	let res: Response;
	try {
		res = await fetchWithHttpDebugLog(c, url, init, {
			tag: `${errorContext.provider}:responsesStream`,
		});
	} catch (error: unknown) {
		const elapsedMs = Date.now() - startedAt;
		const message = error instanceof Error ? error.message : String(error);
		throw new AppError(`${errorContext.provider} Responses 流请求失败`, {
			status: 502,
			code: `${errorContext.provider}_responses_stream_request_failed`,
			details: {
				message,
				upstreamUrl: safeUrl,
				method,
				elapsedMs,
				requestPayload: errorContext.requestPayload ?? null,
			},
		});
	}

	const contentType = String(res.headers.get("content-type") || "").toLowerCase();
	if (res.status >= 200 && res.status < 300) {
		const data = contentType.includes("text/event-stream")
			? await readOpenAIResponsesSseResponseForTask(res)
			: await (async (): Promise<Record<string, unknown>> => {
					const text = await readResponseTextForTask(res);
					const parsed = text ? JSON.parse(text) as unknown : null;
					const record = asOpenAIRecord(parsed);
					if (!record) {
						throw new Error("responses_stream_expected_json_object");
					}
					return record;
			  })();
		const errorRecord = asOpenAIRecord(data.error);
		const status = readOpenAIString(data, "status").toLowerCase();
		if (errorRecord || status === "failed") {
			throw new AppError("NewAPI Responses 流返回错误", {
				status: 502,
				code: `${errorContext.provider}_responses_stream_error`,
				details: {
					upstreamUrl: safeUrl,
					method,
					response: data,
					requestPayload: errorContext.requestPayload ?? null,
				},
			});
		}
		return data;
	}

	const text = await readResponseTextForTask(res);
	const trimmed = text.trim();
	let data: unknown = null;
	if (trimmed) {
		try {
			data = JSON.parse(trimmed) as unknown;
		} catch {
			data = null;
		}
	}
	const upstreamText =
		trimmed.length > 2_000 ? `${trimmed.slice(0, 2_000)}…(truncated, len=${trimmed.length})` : trimmed;
	const payload = asOpenAIRecord(data);
	const errorRecord = asOpenAIRecord(payload?.error);
	const msg =
		readOpenAIString(errorRecord, "message") ||
		readOpenAIString(payload, "message") ||
		`${errorContext.provider} Responses 流调用失败: ${res.status}`;
	const classified = classifyTaskUpstreamHttpError({
		provider: errorContext.provider,
		status: res.status,
		data,
	});
	throw new AppError(classified?.message || msg, {
		status: classified?.status || 502,
		code: classified?.code || `${errorContext.provider}_bad_response_status_code`,
		details: {
			upstreamStatus: res.status,
			upstreamBody: upstreamText || null,
			upstreamUrl: safeUrl,
			method,
			requestPayload: errorContext.requestPayload ?? null,
		},
	});
}

async function callJsonApi(
	c: AppContext,
	url: string,
	init: RequestInit,
	errorContext: { provider: string; requestPayload?: unknown },
	options?: { timeoutMs?: number | null },
): Promise<any> {
	const startedAt = Date.now();
	const safeUrl = (() => {
		try {
			const parsed = new URL(url);
			return `${parsed.origin}${parsed.pathname}`;
		} catch {
			return url;
		}
	})();
	const method =
		typeof init?.method === "string" && init.method.trim()
			? init.method.trim().toUpperCase()
			: null;
	const timeoutMsRaw = options?.timeoutMs;
	const timeoutMs =
		typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
			? Math.max(0, Math.round(timeoutMsRaw))
			: 0;
	const requestInit: RequestInit = { ...init };
	let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
	let timeoutTriggered = false;
	let parentAbortListener: (() => void) | null = null;
	if (timeoutMs > 0) {
		const timeoutController = new AbortController();
		if (init.signal) {
			if (init.signal.aborted) {
				timeoutController.abort();
			} else {
				parentAbortListener = () => timeoutController.abort();
				init.signal.addEventListener("abort", parentAbortListener, { once: true });
			}
		}
		timeoutTimer = setTimeout(() => {
			timeoutTriggered = true;
			timeoutController.abort();
		}, timeoutMs);
		requestInit.signal = timeoutController.signal;
	}

	let res: Response;
	try {
		res = await fetchWithHttpDebugLog(c, url, requestInit, {
			tag: `${errorContext.provider}:jsonApi`,
		});
	} catch (error: any) {
		const timedOut =
			timeoutTriggered ||
			(error?.name === "AbortError" && timeoutMs > 0 && !init.signal?.aborted);
		const elapsedMs = Date.now() - startedAt;
		try {
			const requestId = (() => {
				try {
					const v = (c as any)?.get?.("requestId");
					return typeof v === "string" && v.trim() ? v.trim() : null;
				} catch {
					return null;
				}
			})();
			const safeUrl = (() => {
				try {
					const parsed = new URL(url);
					return `${parsed.origin}${parsed.pathname}`;
				} catch {
					return url;
				}
			})();
			console.warn(
				JSON.stringify({
					ts: new Date().toISOString(),
					type: "vendor_http_error",
					event: timedOut ? "fetch_timeout" : "fetch_failed",
					requestId,
					provider: errorContext.provider,
					method,
					url: safeUrl,
					message: typeof error?.message === "string" ? error.message : String(error),
					elapsedMs,
					...(timedOut ? { timeoutMs } : {}),
				}),
			);
		} catch {
			// ignore
		}
		throw new AppError(
			timedOut ? `${errorContext.provider} 请求超时` : `${errorContext.provider} 请求失败`,
			{
				status: timedOut ? 504 : 502,
				code: `${errorContext.provider}_${timedOut ? "request_timeout" : "request_failed"}`,
				details: {
					message: error?.message ?? String(error),
					upstreamUrl: safeUrl,
					method,
					elapsedMs,
					requestPayload: errorContext.requestPayload ?? null,
					...(timedOut ? { timeoutMs } : {}),
				},
			},
		);
	} finally {
		if (timeoutTimer) clearTimeout(timeoutTimer);
		if (init.signal && parentAbortListener) {
			try {
				init.signal.removeEventListener("abort", parentAbortListener);
			} catch {
				// ignore
			}
		}
	}

	if (res.status >= 200 && res.status < 300) {
		let data: any = null;
		try {
			data = await res.json();
		} catch {
			data = null;
		}
		return data;
	}

	let text: string | null = null;
	try {
		text = await res.text();
	} catch {
		text = null;
	}

	const trimmed = typeof text === "string" ? text.trim() : "";
	let data: any = null;
	if (trimmed) {
		try {
			data = JSON.parse(trimmed);
		} catch {
			data = null;
		}
	}

	const upstreamText = (() => {
		if (!trimmed) return null;
		const limit = 2_000;
		if (trimmed.length <= limit) return trimmed;
		return `${trimmed.slice(0, limit)}…(truncated, len=${trimmed.length})`;
	})();

	{
		const msg =
			(data && (data.error?.message || data.message || data.error)) ||
			`${errorContext.provider} 调用失败: ${res.status}`;
		const classified = classifyTaskUpstreamHttpError({
			provider: errorContext.provider,
			status: res.status,
			data,
		});
		try {
			const requestId = (() => {
				try {
					const v = (c as any)?.get?.("requestId");
					return typeof v === "string" && v.trim() ? v.trim() : null;
				} catch {
					return null;
				}
			})();
			const safeUrl = (() => {
				try {
					const parsed = new URL(url);
					return `${parsed.origin}${parsed.pathname}`;
				} catch {
					return url;
				}
			})();
			console.warn(
				JSON.stringify({
					ts: new Date().toISOString(),
					type: "vendor_http_error",
					event: "non_2xx",
					requestId,
					provider: errorContext.provider,
					method,
					url: safeUrl,
					status: res.status,
					message: typeof msg === "string" ? msg.slice(0, 300) : String(msg).slice(0, 300),
				}),
			);
		} catch {
			// ignore
		}

		throw new AppError(classified?.message ?? msg, {
			status: classified?.status ?? res.status,
			code: classified?.code ?? `${errorContext.provider}_request_failed`,
			details: {
				upstreamStatus: res.status,
				upstreamData: data ?? null,
				upstreamUrl: safeUrl,
				method,
				requestPayload: errorContext.requestPayload ?? null,
				...(upstreamText ? { upstreamText } : {}),
			},
		});
	}
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

	type AsyncDataTaskRef = {
		id: string;
		webUrl: string | null;
		sourceUrl: string | null;
	};

	function extractAsyncDataTaskRefFromText(text: string): AsyncDataTaskRef | null {
		if (typeof text !== "string" || !text.trim()) return null;

		const normalized = text.trim();
		const uuid =
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

		const refsById = new Map<string, { webUrl: string | null; sourceUrl: string | null }>();

		const linkRegex =
			/https?:\/\/[^\s)]+asyncdata\.net\/(web|source)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
		let match: RegExpExecArray | null;
		// eslint-disable-next-line no-cond-assign
		while ((match = linkRegex.exec(normalized)) !== null) {
			const kind = (match[1] || "").toLowerCase();
			const id = (match[2] || "").toLowerCase();
			if (!id) continue;

			const url = match[0].trim();
			const current = refsById.get(id) || { webUrl: null, sourceUrl: null };
			if (kind === "web") current.webUrl = current.webUrl || url;
			if (kind === "source") current.sourceUrl = current.sourceUrl || url;
			refsById.set(id, current);
		}

		if (refsById.size > 0) {
			// Prefer IDs that have both web + source links.
			for (const [id, ref] of refsById.entries()) {
				if (ref.webUrl && ref.sourceUrl) {
					return { id, webUrl: ref.webUrl, sourceUrl: ref.sourceUrl };
				}
			}
			const first = refsById.entries().next().value as
				| [string, { webUrl: string | null; sourceUrl: string | null }]
				| undefined;
			if (first) {
				return { id: first[0], webUrl: first[1].webUrl, sourceUrl: first[1].sourceUrl };
			}
		}

		// Fallback: "ID: <uuid>" pattern (with or without backticks).
		{
			const m =
				normalized.match(
					new RegExp(
						`\\bID\\s*[:：]\\s*` +
							"`?" +
							`(${uuid.source})` +
							"`?",
						"i",
					),
				) || null;
			const id = m?.[1] ? String(m[1]).toLowerCase() : "";
			if (id) return { id, webUrl: null, sourceUrl: null };
		}

		// Last resort: if the text mentions asyncdata, try to grab any UUID.
		if (/asyncdata/i.test(normalized)) {
			const m = normalized.match(uuid);
			const id = m?.[0] ? String(m[0]).toLowerCase() : "";
			if (id) return { id, webUrl: null, sourceUrl: null };
		}

		return null;
	}

	function extractProgressPercentFromText(text: string): number | null {
		if (typeof text !== "string" || !text.trim()) return null;

		const idx = (() => {
			const m = text.search(/(进度|progress)/i);
			return m >= 0 ? m : -1;
		})();
		if (idx < 0) return null;

		const slice = text.slice(idx, idx + 160);
		const nums = slice.match(/\b\d{1,3}\b/g) || [];
		const values = nums
			.map((n) => Number.parseInt(n, 10))
			.filter((n) => Number.isFinite(n) && n >= 0 && n <= 100);
		if (!values.length) return null;
		return Math.max(...values);
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

		const MAX_BYTES = 100 * 1024 * 1024;
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

async function resolveDefaultModelKeyFromCatalogForVendor(
	c: AppContext,
	vendorKey: string,
	kind: "text" | "image" | "video",
): Promise<string | null> {
	const vk = normalizeVendorKey(vendorKey);
	if (!vk) return null;
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const row = await getPrismaClient().model_catalog_models.findFirst({
			where: {
				vendor_key: { equals: vk, mode: "insensitive" },
				kind,
				enabled: 1,
				model_key: { not: "gpt-image-2-official" },
			},
			orderBy: [{ updated_at: "desc" }, { created_at: "desc" }, { model_key: "asc" }],
			select: { model_key: true },
		});
		const modelKey =
			typeof row?.model_key === "string" && row.model_key.trim()
				? row.model_key.trim()
				: null;
		return modelKey;
	} catch {
		return null;
	}
}

async function runTaskViaNewApi(
	c: AppContext,
	userId: string,
	vendorKey: string,
	req: TaskRequestDto,
	options?: { forceTaskId?: string | null },
): Promise<TaskResult> {
	const relay = resolveNewApiRelayConfig(c);
	if (!relay) {
		throw new AppError("NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置", {
			status: 500,
			code: "new_api_not_configured",
		});
	}

	const startedAtMs = Date.now();
	const v = normalizeVendorKey(vendorKey);
	const newApiVendorTag = v === "newapi" || v === "auto" ? "newapi" : `newapi:${v}`;
	const model = await resolveTaskModelKeyForNewApi(c, v, req);
	await assertNewApiRouteEnabledForTask(c, {
		vendorKey: v,
		modelKey: model,
		taskKind: req.kind,
	});
	const isImageTask = req.kind === "text_to_image" || req.kind === "image_edit";
	const imageOptions = isImageTask ? await resolveNewApiImageOptions(c, v, model) : null;
	const imageRequestShape = isImageTask
		? buildNewApiImageRequestShape({
				req,
				imageOptions,
			})
		: null;
	if (
		imageRequestShape &&
		String(model || "").trim().toLowerCase() === "gpt-image-2-official"
	) {
		imageRequestShape.quality = "high";
	}
	let billingSpecKey = extractBillingSpecKeyFromTaskRequest(req);
	// For image tasks: derive billing spec key from resolution if not explicitly set.
	if (!billingSpecKey && imageRequestShape) {
		billingSpecKey = buildImageBillingSpecKey(imageRequestShape);
	}
	if (isImageTask && isGptImage2OfficialModel(model)) {
		const derivedSpecKey = imageRequestShape ? buildImageBillingSpecKey(imageRequestShape) : null;
		if (!isRichOfficialImageBillingSpecKey(billingSpecKey)) {
			billingSpecKey = isRichOfficialImageBillingSpecKey(derivedSpecKey) ? derivedSpecKey : null;
		}
		if (!billingSpecKey) {
			throw new AppError("gpt-image-2-official 图片计费规格缺失，必须包含比例、分辨率和质量", {
				status: 400,
				code: "image_billing_spec_required",
				details: {
					modelKey: model,
					taskKind: req.kind,
					parsedShape: imageRequestShape,
					requestSpecKey: extractBillingSpecKeyFromTaskRequest(req),
				},
			});
		}
	}
	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
		...(billingSpecKey ? { specKey: billingSpecKey } : {}),
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: newApiVendorTag,
		modelKey: model,
		...(billingSpecKey ? { specKey: billingSpecKey } : {}),
	});

	// Settle or release a reservation immediately for synchronously completed tasks.
	// The credit finalizer is designed for async (pending) tasks and cannot reliably
	// settle same-request completions for new-api (image polling is skipped; chat
	// has no video task ref to poll against).
	async function settleNow(taskId: string, taskKind: string, succeeded: boolean): Promise<void> {
		if (!reservation) return;
		try {
			if (succeeded) {
				await settleTeamCreditsOnSuccess(c, userId, {
					taskId, taskKind, amount: required,
					vendor: newApiVendorTag, modelKey: model, specKey: billingSpecKey ?? null,
				});
			} else {
				await releaseTeamCreditsOnFailure(c, userId, {
					taskId, taskKind,
					vendor: newApiVendorTag, modelKey: model, specKey: billingSpecKey ?? null,
				});
			}
		} catch (err) {
			console.warn("[new-api] sync settlement failed", err);
		}
	}

	try {
		const extras = (req.extras || {}) as Record<string, any>;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${relay.token}`,
			Accept: "application/json",
			"Content-Type": "application/json",
		};



		if (req.kind === "chat" || req.kind === "prompt_refine" || req.kind === "image_to_prompt") {
			const systemPrompt =
				req.kind === "prompt_refine"
					? pickSystemPrompt(
							req,
							"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
						)
					: pickSystemPrompt(req, "请用中文回答。");
			const referenceImages =
				req.kind === "image_to_prompt" || Array.isArray(extras.referenceImages)
					? collectTaskReferenceImageUrls(extras).slice(0, 8)
					: [];
			const messages: OpenAIChatMessageForTask[] = [];
			const userContent: string | OpenAIContentPartForTask[] = referenceImages.length
				? [
						{ type: "text", text: req.prompt },
						...referenceImages.map(
							(url): OpenAIContentPartForTask => ({
								type: "image_url",
								image_url: { url },
							}),
						),
				  ]
				: req.prompt;
			messages.push({ role: "user", content: userContent });

			const useResponsesApi = /^gpt-/i.test(String(model || "").trim());
			// /v1/responses 不带 temperature：gpt-5 系列 reasoning 模型只接受默认值，
			// 显式传 0.7 会被 OpenAI 拒成 400（new-api 上抛为 bad_response_status_code），
			// 与 agents-cli/src/llm/client.ts 的 callResponses 约定一致。
			const body = useResponsesApi
				? {
						model,
						input: convertMessagesToResponsesInput(messages),
						stream: true,
						...(systemPrompt ? { instructions: systemPrompt } : {}),
				  }
				: {
						model,
						messages: [
							...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
							...messages,
						],
						stream: false,
						temperature: normalizeTemperature(extras.temperature, 0.7),
				  };
			const url = buildNewApiV1Url(
				relay.baseUrl,
				useResponsesApi ? "/v1/responses" : "/v1/chat/completions",
			);
			const data = useResponsesApi
				? await callOpenAIResponsesStreamApi(
						c,
						url,
						{
							method: "POST",
							headers: { ...headers, Accept: "text/event-stream" },
							body: JSON.stringify(body),
						},
						{ provider: `newapi:${v}`, requestPayload: body },
				  )
				: await callJsonApi(
						c,
						url,
						{ method: "POST", headers, body: JSON.stringify(body) },
						{ provider: `newapi:${v}`, requestPayload: body },
				  );
			const text = extractTextFromOpenAIResponseForTask(data);
			const id =
				(typeof data?.id === "string" && data.id.trim()) ||
				`${v}-txt-${Date.now().toString(36)}`;

			const chatStatus = text ? "succeeded" : "failed";
			await bindReservationToTaskId(c, userId, reservation, id);
			await settleNow(id, req.kind, chatStatus === "succeeded");
			return attachBillingSpecKeyToTaskResult(
				TaskResultSchema.parse({
					id,
					kind: req.kind,
					status: chatStatus,
					assets: [],
					raw: {
						provider: "new_api",
						vendor: `newapi:${v}`,
						model,
						text,
						response: data,
					},
				}),
				billingSpecKey,
			);
		}

		if (req.kind === "text_to_image" || req.kind === "image_edit") {
			const refs = collectTaskReferenceImageUrls(extras);
			const maskUrl = req.kind === "image_edit" ? resolveTaskMaskUrl(extras) : null;
			if (!imageRequestShape) {
				throw new AppError("图片请求规格解析失败", {
					status: 500,
					code: "image_request_shape_unavailable",
				});
			}
			let data: any;
			let capturedUpstreamBody: unknown = null;
			try {
				if (maskUrl) {
					if (!refs.length) {
						throw new AppError("image_edit 使用 mask 时必须同时提供待编辑底图", {
							status: 400,
							code: "image_edit_mask_missing_base_image",
						});
					}
					const form = new FormData();
					form.append("model", model);
					form.append("prompt", req.prompt);
					form.append("response_format", "url");
					form.append("n", "1");
					form.append("user", String(userId));
					if (imageRequestShape.size) {
						form.append("size", imageRequestShape.size);
					}
					if (imageRequestShape.resolution) {
						form.append("resolution", imageRequestShape.resolution);
					}
					if (imageRequestShape.quality) {
						form.append("quality", imageRequestShape.quality);
					}
					if (typeof req.negativePrompt === "string" && req.negativePrompt.trim()) {
						form.append("negative_prompt", req.negativePrompt.trim());
					}
					if (typeof req.seed === "number" && Number.isFinite(req.seed)) {
						form.append("seed", String(Math.trunc(req.seed)));
					}
					if (imageRequestShape.metadata && Object.keys(imageRequestShape.metadata).length > 0) {
						form.append("metadata", JSON.stringify(imageRequestShape.metadata));
					}
					for (let index = 0; index < refs.length; index += 1) {
						const filePart = await resolveNewApiImageFilePart(c, refs[index] || "", "image");
						form.append(refs.length > 1 ? "image[]" : "image", filePart.blob, filePart.filename);
					}
					const maskFilePart = await resolveNewApiImageFilePart(c, maskUrl, "mask");
					form.append("mask", maskFilePart.blob, maskFilePart.filename);

					const requestPayload = {
						model,
						prompt: req.prompt,
						response_format: "url",
						n: 1,
						user: String(userId),
						...(imageRequestShape.size ? { size: imageRequestShape.size } : {}),
						...(imageRequestShape.resolution ? { resolution: imageRequestShape.resolution } : {}),
						...(imageRequestShape.quality ? { quality: imageRequestShape.quality } : {}),
						...(typeof req.negativePrompt === "string" && req.negativePrompt.trim()
							? { negative_prompt: req.negativePrompt.trim() }
							: {}),
						...(typeof req.seed === "number" && Number.isFinite(req.seed)
							? { seed: Math.trunc(req.seed) }
							: {}),
						...(imageRequestShape.metadata && Object.keys(imageRequestShape.metadata).length > 0
							? { metadata: imageRequestShape.metadata }
							: {}),
						images: refs,
						mask: maskUrl,
					};
					capturedUpstreamBody = requestPayload;
					data = await callJsonApi(
						c,
						buildNewApiV1Url(relay.baseUrl, "/v1/images/edits"),
						{
							method: "POST",
							headers: {
								Authorization: headers.Authorization,
								Accept: headers.Accept,
							},
							body: form,
						},
						{ provider: `newapi:${v}`, requestPayload },
					);
				} else {
					const body = buildNewApiImageGenerationBody({
						model,
						prompt: req.prompt,
						size: imageRequestShape.size,
						resolution: imageRequestShape.resolution,
						quality: imageRequestShape.quality,
						metadata: imageRequestShape.metadata,
						negativePrompt: req.negativePrompt,
						seed: req.seed,
						referenceImages: refs,
						user: String(userId),
					});
					capturedUpstreamBody = body;
					data = await callJsonApi(
						c,
						buildNewApiV1Url(relay.baseUrl, "/v1/images/generations"),
						{ method: "POST", headers, body: JSON.stringify(body) },
						{ provider: `newapi:${v}`, requestPayload: body },
						{ timeoutMs: 960_000 },
					);
				}
			} catch (callErr: any) {
				const failedId = `${v}-img-err-${Date.now().toString(36)}`;
				const nowIso = new Date().toISOString();
				await settleNow(failedId, req.kind, false);
				upsertVendorCallLogPayloads(c.env.DB, {
					userId,
					vendor: newApiVendorTag,
					taskId: failedId,
					taskKind: req.kind,
					request: { vendor: v, request: req, upstreamBody: capturedUpstreamBody },
					upstreamResponse: { error: callErr?.message ?? String(callErr) },
					nowIso,
				}).catch(() => {});
				upsertVendorCallLogFinal(c.env.DB, {
					userId,
					vendor: newApiVendorTag,
					taskId: failedId,
					taskKind: req.kind,
					status: "failed",
					errorMessage: callErr?.message ?? null,
					durationMs: Date.now() - startedAtMs,
					nowIso,
				}).catch(() => {});
				throw callErr;
			}
			const assets = extractNewApiImageAssets(data);
			const id =
				(typeof data?.id === "string" && data.id.trim()) ||
				(typeof data?.created === "number" ? `img-${data.created}-${Date.now().toString(36)}` : "") ||
				`${v}-img-${Date.now().toString(36)}`;

			const imageStatus = assets.length ? "succeeded" : "failed";
			await bindReservationToTaskId(c, userId, reservation, id);
			await settleNow(id, req.kind, imageStatus === "succeeded");
			const imageResult = attachBillingSpecKeyToTaskResult(
				TaskResultSchema.parse({
					id,
					kind: req.kind,
					status: imageStatus,
					assets,
					raw: {
						provider: "new_api",
						vendor: `newapi:${v}`,
						model,
						response: data,
					},
				}),
				billingSpecKey,
			);
			recordVendorCallPayloads(c, {
				userId,
				vendor: newApiVendorTag,
				taskId: id,
				taskKind: req.kind,
				request: { vendor: v, request: req, upstreamBody: capturedUpstreamBody },
				upstreamResponse: { status: imageStatus, raw: imageResult.raw },
			}).catch(() => {});
			recordVendorCallForTaskResult(c, {
				userId,
				vendor: newApiVendorTag,
				taskKind: req.kind,
				result: imageResult,
				durationMs: Date.now() - startedAtMs,
			}).catch(() => {});
			return imageResult;
		}

		const forcedTaskId =
			typeof options?.forceTaskId === "string" && options.forceTaskId.trim()
				? options.forceTaskId.trim()
				: "";
		const upstreamVideoUrl =
			typeof extras.upstreamVideoUrl === "string" &&
			/^https?:\/\//i.test(extras.upstreamVideoUrl.trim())
				? extras.upstreamVideoUrl.trim()
				: "";
		const refs = collectTaskReferenceImageUrls(extras);
		const effectiveVideoTaskKind: TaskRequestDto["kind"] = upstreamVideoUrl
			? "image_to_video"
			: req.kind === "text_to_video" && refs.length > 0
				? "image_to_video"
				: req.kind;
		const url = buildNewApiV1Url(relay.baseUrl, "/v1/videos");
		const seconds =
			typeof extras.durationSeconds === "number" && Number.isFinite(extras.durationSeconds)
				? Math.max(1, Math.floor(extras.durationSeconds))
				: typeof extras.duration === "number" && Number.isFinite(extras.duration)
					? Math.max(1, Math.floor(extras.duration))
					: undefined;
		const videoRequestShape = buildNewApiVideoRequestShape(v, req);
		const metadata = {
			vendor: v,
			taskKind: effectiveVideoTaskKind,
			...(typeof req.negativePrompt === "string" && req.negativePrompt.trim()
				? { negative_prompt: req.negativePrompt.trim() }
				: {}),
		};

		let requestInit: RequestInit;
		let requestPayload: Record<string, unknown>;

		if (isKlingMotionControlModel(model)) {
			if (!upstreamVideoUrl) {
				throw new AppError("kling-motion-control 必须提供参考视频 (extras.upstreamVideoUrl)", {
					status: 400,
					code: "kling_motion_control_missing_video",
				});
			}
			const imageUrl = refs[0] || "";
			if (!imageUrl) {
				throw new AppError("kling-motion-control 必须提供参考图片 (extras.referenceImages 或 image_url)", {
					status: 400,
					code: "kling_motion_control_missing_image",
				});
			}
			const orientation = normalizeKlingCharacterOrientation(extras.characterOrientation ?? extras.character_orientation ?? extras.motionOrientation);
			const mode =
				extractKlingMotionModeFromSpecKey(extras.specKey ?? extras.videoSpecKey ?? extras.billingSpecKey) ??
				normalizeKlingMotionMode(extras.motionMode ?? extras.mode);
			const keepOriginalSound = normalizeKlingKeepOriginalSound(
				extras.keepOriginalSound ?? extras.keep_original_sound,
			);
			const watermarkEnabled =
				extras.watermarkEnabled === true || extras.watermark_enabled === true;
			const validatedSeconds =
				typeof seconds === "number"
					? validateKlingMotionDurationSeconds({ orientation, durationSeconds: seconds })
					: undefined;
			const motionMetadata = buildKlingMotionControlMetadata({
				vendor: v,
				imageUrl,
				videoUrl: upstreamVideoUrl,
				mode,
				orientation,
				keepOriginalSound,
				watermarkEnabled,
				...(typeof validatedSeconds === "number" ? { durationSeconds: validatedSeconds } : {}),
				...(typeof req.negativePrompt === "string" && req.negativePrompt.trim()
					? { negativePrompt: req.negativePrompt.trim() }
					: {}),
			});
			const body: Record<string, unknown> = {
				model,
				prompt: req.prompt,
				response_format: "url",
				n: 1,
				metadata: motionMetadata,
			};
			if (typeof req.seed === "number" && Number.isFinite(req.seed)) {
				body.seed = Math.trunc(req.seed);
			}
			requestInit = {
				method: "POST",
				headers: {
					Authorization: `Bearer ${relay.token}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			};
			requestPayload = body;
		} else if (upstreamVideoUrl) {
			const contentItems: unknown[] = [
				{ type: "video_url", video_url: { url: upstreamVideoUrl } },
				...refs.map((u) => ({ type: "image_url", image_url: { url: u } })),
			];
			const metadataWithContent = {
				...metadata,
				content: contentItems,
			};
			const body: Record<string, unknown> = {
				model,
				prompt: req.prompt,
				response_format: "url",
				n: 1,
				metadata: metadataWithContent,
			};
			if (typeof req.seed === "number" && Number.isFinite(req.seed)) {
				body.seed = Math.trunc(req.seed);
			}
			if (videoRequestShape.size) body.size = videoRequestShape.size;
			if (videoRequestShape.resolution) body.resolution = videoRequestShape.resolution;
			if (videoRequestShape.aspectRatio) body.aspect_ratio = videoRequestShape.aspectRatio;
			if (typeof seconds === "number") body.duration = seconds;
			requestInit = {
				method: "POST",
				headers: {
					Authorization: `Bearer ${relay.token}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			};
			requestPayload = body;
		} else if (refs.length > 0) {
			const directReferenceUrl = isDirectNewApiVideoReferenceUrl(refs[0]) ? refs[0].trim() : "";
			if (directReferenceUrl) {
				const body: Record<string, unknown> = {
					model,
					prompt: req.prompt,
					response_format: "url",
					n: 1,
					images: [directReferenceUrl],
					metadata,
				};
				if (typeof req.seed === "number" && Number.isFinite(req.seed)) {
					body.seed = Math.trunc(req.seed);
				}
				if (videoRequestShape.size) body.size = videoRequestShape.size;
				if (videoRequestShape.resolution) {
					body.resolution = videoRequestShape.resolution;
				}
				if (videoRequestShape.aspectRatio) {
					body.aspect_ratio = videoRequestShape.aspectRatio;
				}
				if (typeof seconds === "number") body.duration = seconds;
				requestInit = {
					method: "POST",
					headers: {
						Authorization: `Bearer ${relay.token}`,
						Accept: "application/json",
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				};
				requestPayload = body;
			} else {
				const filePart = await resolveNewApiImageFilePart(c, refs[0], "image");
				const form = new FormData();
				form.append("model", model);
				form.append("prompt", req.prompt);
				form.append("response_format", "url");
				form.append("n", "1");
				form.append("input_reference", filePart.blob, filePart.filename);
				form.append("metadata", JSON.stringify(metadata));
				if (typeof req.seed === "number" && Number.isFinite(req.seed)) {
					form.append("seed", String(Math.trunc(req.seed)));
				}
				if (videoRequestShape.size) form.append("size", videoRequestShape.size);
				if (videoRequestShape.resolution) {
					form.append("resolution", videoRequestShape.resolution);
				}
				if (videoRequestShape.aspectRatio) {
					form.append("aspect_ratio", videoRequestShape.aspectRatio);
				}
				if (typeof seconds === "number") form.append("duration", String(seconds));

				requestInit = {
					method: "POST",
					headers: {
						Authorization: `Bearer ${relay.token}`,
						Accept: "application/json",
					},
					body: form,
				};
				requestPayload = {
					model,
					prompt: req.prompt,
					response_format: "url",
					n: 1,
					input_reference: refs[0],
					metadata,
					...(typeof req.seed === "number" && Number.isFinite(req.seed)
						? { seed: Math.trunc(req.seed) }
						: {}),
					...(videoRequestShape.size ? { size: videoRequestShape.size } : {}),
					...(videoRequestShape.resolution
						? { resolution: videoRequestShape.resolution }
						: {}),
					...(videoRequestShape.aspectRatio
						? { aspect_ratio: videoRequestShape.aspectRatio }
						: {}),
					...(typeof seconds === "number" ? { duration: seconds } : {}),
				};
			}
		} else {
			const body: Record<string, unknown> = {
				model,
				prompt: req.prompt,
				response_format: "url",
				n: 1,
				metadata,
			};
			if (typeof req.seed === "number" && Number.isFinite(req.seed)) {
				body.seed = Math.trunc(req.seed);
			}
			if (videoRequestShape.size) body.size = videoRequestShape.size;
			if (videoRequestShape.resolution) {
				body.resolution = videoRequestShape.resolution;
			}
			if (videoRequestShape.aspectRatio) {
				body.aspect_ratio = videoRequestShape.aspectRatio;
			}
			if (typeof seconds === "number") body.duration = seconds;

			requestInit = {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			};
			requestPayload = body;
		}

		const data = await callJsonApi(
			c,
			url,
			requestInit,
			{ provider: `newapi:${v}`, requestPayload },
		);
		const assets = extractNewApiVideoAssets(data);
		const upstreamTaskId =
			(typeof data?.id === "string" && data.id.trim()) ||
			(typeof data?.task_id === "string" && data.task_id.trim()) ||
			(typeof data?.taskId === "string" && data.taskId.trim()) ||
			"";
		const id = forcedTaskId || upstreamTaskId || `${v}-vid-${Date.now().toString(36)}`;
		const status =
			assets.length > 0
				? "succeeded"
				: normalizeNewApiVideoStatus(data?.status || data?.state || data?.task_status);

		if (upstreamTaskId) {
			await upsertVendorTaskRefWithWarn(c, {
				userId,
				kind: "video",
				taskId: id,
				vendor: `newapi:${v}`,
				...(upstreamTaskId !== id ? { pid: upstreamTaskId } : {}),
				warnTag: "upsert new-api video ref failed",
			});
		}

		await bindReservationToTaskId(c, userId, reservation, id);
		// Settle immediately for sync completions; async tasks rely on the finalizer.
		if (status === "succeeded" || status === "failed") {
			await settleNow(id, effectiveVideoTaskKind, status === "succeeded");
		}
		const videoResult = attachBillingSpecKeyToTaskResult(
			TaskResultSchema.parse({
				id,
				kind: effectiveVideoTaskKind,
				status,
				assets,
				raw: {
					provider: "new_api",
					vendor: `newapi:${v}`,
					model,
					taskKind: effectiveVideoTaskKind,
					upstreamTaskId: upstreamTaskId || null,
					response: data,
				},
			}),
			billingSpecKey,
		);
		recordVendorCallPayloads(c, {
			userId,
			vendor: newApiVendorTag,
			taskId: id,
			taskKind: effectiveVideoTaskKind,
			request: { vendor: v, request: req, upstreamBody: requestPayload },
			upstreamResponse: data,
		}).catch(() => {});
		return videoResult;
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

export async function fetchNewApiTaskResult(
	c: AppContext,
	userId: string,
	taskId: string,
	input?: {
		taskKind?: TaskRequestDto["kind"] | null;
		vendor?: string | null;
		promptFromClient?: string | null;
	},
): Promise<TaskResult> {
	const relay = resolveNewApiRelayConfig(c);
	if (!relay) {
		throw new AppError("NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置", {
			status: 500,
			code: "new_api_not_configured",
		});
	}

	const ref = await getVendorTaskRefByTaskId(c.env.DB, userId, "video", taskId).catch(() => null);
	const upstreamTaskId =
		typeof ref?.pid === "string" && ref.pid.trim() ? ref.pid.trim() : taskId.trim();
	const vendorRaw =
		typeof input?.vendor === "string" && input.vendor.trim()
			? input.vendor.trim()
			: typeof ref?.vendor === "string" && ref.vendor.trim()
				? ref.vendor.trim()
				: "newapi";

	const url = buildNewApiV1Url(
		relay.baseUrl,
		`/v1/videos/${encodeURIComponent(upstreamTaskId)}`,
	);
	const data = await callJsonApi(
		c,
		url,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${relay.token}`,
				Accept: "application/json",
			},
		},
		{ provider: vendorRaw },
	);
	const assets = extractNewApiVideoAssets(data);
	const parsedResult = TaskResultSchema.parse({
		id: taskId.trim(),
		kind: (input?.taskKind as TaskRequestDto["kind"]) || "text_to_video",
		status: assets.length ? "succeeded" : normalizeNewApiVideoStatus(data?.status || data?.state || data?.task_status),
		assets,
		raw: {
			provider: "new_api",
			vendor: vendorRaw,
			upstreamTaskId,
			response: data,
			prompt: input?.promptFromClient ?? null,
		},
	});
	if (parsedResult.status !== "succeeded" || parsedResult.assets.length === 0) {
		return parsedResult;
	}
	return hostTaskAssetsSynchronously({
		c,
		userId,
		result: parsedResult,
		meta: {
			taskKind: parsedResult.kind,
			prompt: input?.promptFromClient ?? null,
			vendor: vendorRaw,
			taskId: parsedResult.id,
		},
		traceTaskKind: parsedResult.kind,
		traceVendor: vendorRaw,
	});
}

export async function runGenericTaskForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
	req: TaskRequestDto,
	options?: { forceTaskId?: string | null },
): Promise<TaskResult> {
	void vendor;
	const v = "newapi";
	setTraceStage(c, "task:run:begin", { vendor: v, taskKind: req.kind });
	const progressCtx = extractProgressContext(req, v);
	const startedAtMs = Date.now();
	const forcedTaskId =
		typeof options?.forceTaskId === "string" && options.forceTaskId.trim()
			? options.forceTaskId.trim()
			: "";

	// 所有厂商统一：/tasks 视为“创建任务”，立即发出 queued/running 事件
	emitProgress(userId, progressCtx, {
		status: "queued",
		progress: 0,
		...(forcedTaskId ? { taskId: forcedTaskId } : {}),
	});

	try {
		emitProgress(userId, progressCtx, {
			status: "running",
			progress: 5,
			...(forcedTaskId ? { taskId: forcedTaskId } : {}),
		});

		let result: TaskResult;

		setTraceStage(c, "task:vendor:dispatch", { vendor: v, taskKind: req.kind });
		if (!resolveNewApiRelayConfig(c)) {
			throw new AppError(
				"hono-api 已硬切到 new-api，但 NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置",
				{
					status: 500,
					code: "new_api_not_configured",
					details: { vendor: v, taskKind: req.kind },
				},
			);
		}
		result = await runTaskViaNewApi(c, userId, v, req, options);

		const apiVendor = pickApiVendorForTask(result, v);
		const persistAssets =
			typeof (req.extras as any)?.persistAssets === "boolean"
				? (req.extras as any).persistAssets
				: true;

		// When enqueued via task_store, keep the returned TaskResult.id stable so clients can poll
		// using the same taskId they received from the create endpoint.
		if (forcedTaskId) {
			const vendorTaskId =
				typeof result?.id === "string"
					? result.id.trim()
					: String(result?.id || "").trim();
			const rawObj =
				typeof result.raw === "object" && result.raw ? (result.raw as any) : {};
			const existingUpstreamTaskId =
				typeof rawObj?.upstreamTaskId === "string" && rawObj.upstreamTaskId.trim()
					? rawObj.upstreamTaskId.trim()
					: null;

			// If the vendor returned a different task id, preserve it (and any upstream id) for polling/debug.
			if (vendorTaskId && vendorTaskId !== forcedTaskId) {
				const inferredPid = existingUpstreamTaskId || vendorTaskId;
				const refKind =
					req.kind === "text_to_video" || req.kind === "image_to_video"
						? ("video" as const)
						: req.kind === "text_to_image" || req.kind === "image_edit"
							? ("image" as const)
							: null;
					if (refKind && inferredPid && inferredPid !== forcedTaskId) {
						await upsertVendorTaskRefWithWarn(c, {
							userId,
							kind: refKind,
							taskId: forcedTaskId,
							vendor: apiVendor,
							pid: inferredPid,
							warnTag: "upsert forced task ref failed",
						});
					}

				result = TaskResultSchema.parse({
					...result,
					id: forcedTaskId,
					raw: {
						...rawObj,
						// Keep a stable client-visible id, but don't clobber an upstream id if one already exists.
						...(existingUpstreamTaskId ? {} : { upstreamTaskId: vendorTaskId }),
						vendorTaskId,
						taskStoreId: forcedTaskId,
					},
				});
			} else if (
				typeof rawObj?.taskStoreId !== "string" ||
				rawObj.taskStoreId !== forcedTaskId
			) {
				// Ensure taskStoreId is present for debugging even when ids already match.
				result = TaskResultSchema.parse({
					...result,
					raw: { ...rawObj, taskStoreId: forcedTaskId },
				});
			}
		}

		if (result.status === "succeeded" && result.assets && result.assets.length > 0) {
			const taskIdForHosting =
				typeof result.id === "string" && result.id.trim() ? result.id.trim() : null;
			const modelKeyForHosting =
				typeof (req.extras as any)?.modelKey === "string" &&
				(req.extras as any).modelKey.trim()
					? (req.extras as any).modelKey.trim()
					: null;
			result = await hostTaskAssetsSynchronously({
				c,
				userId,
				result,
				meta: {
					taskKind: req.kind,
					prompt: req.prompt,
					vendor: apiVendor,
					modelKey: modelKeyForHosting,
					taskId: taskIdForHosting,
				},
				traceTaskKind: req.kind,
				traceVendor: apiVendor,
			});
			const rawRecord =
				typeof result.raw === "object" && result.raw !== null
					? (result.raw as Record<string, unknown>)
					: {};
			result = TaskResultSchema.parse({
				...result,
				raw: {
					...rawRecord,
					persistAssets,
				},
			});
		}

		// 统一发出完成事件，便于前端通过 /tasks/pending 聚合观察
			emitProgress(userId, progressCtx, {
				status: result.status,
				progress: result.status === "succeeded" ? 100 : undefined,
				taskId: result.id,
				assets: result.assets,
				raw: result.raw,
			});

			await recordVendorCallPayloads(c, {
				userId,
				vendor: apiVendor,
				taskId: result.id,
				taskKind: req.kind,
				request: { vendor: v, request: req },
				upstreamResponse: { status: result.status, raw: result.raw },
			});

			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: apiVendor,
				taskKind: req.kind,
			result,
			durationMs: Date.now() - startedAtMs,
		});

		return result;
	} catch (err: any) {
		// 失败时也发一条 failed snapshot，方便前端统一处理
		const message =
			typeof err?.message === "string"
				? err.message
				: "任务执行失败";
		const vendorFromDetails =
			typeof err?.details?.vendor === "string" && err.details.vendor.trim()
				? normalizeVendorKey(err.details.vendor)
				: "";
		const proxyVendorHint = (() => {
			try {
				const hint = (c as any)?.get?.("proxyVendorHint");
				return typeof hint === "string" && hint.trim()
					? normalizeVendorKey(hint)
					: "";
			} catch {
				return "";
			}
		})();
		const failedVendor = vendorFromDetails || proxyVendorHint || v;
		const failedTaskId = (() => {
			if (forcedTaskId) return forcedTaskId;
			const detailCandidates = [
				err?.details?.taskId,
				err?.details?.task_id,
				err?.details?.upstreamTaskId,
				err?.details?.vendorTaskId,
			];
			for (const candidate of detailCandidates) {
				if (typeof candidate === "string" && candidate.trim()) {
					return candidate.trim();
				}
			}
			return `failed-${Date.now().toString(36)}-${crypto
				.randomUUID()
				.split("-")[0]}`;
		})();

		const failedResult = TaskResultSchema.parse({
			id: failedTaskId,
			kind: req.kind,
			status: "failed",
			assets: [],
			raw: {
				vendor: failedVendor,
				error: message,
				code: typeof err?.code === "string" ? err.code : null,
				status:
					typeof err?.status === "number"
						? err.status
						: Number.isFinite(Number(err?.status))
							? Number(err.status)
							: null,
				details: err?.details ?? null,
			},
		});

		await recordVendorCallPayloads(c, {
			userId,
			vendor: failedVendor,
			taskId: failedTaskId,
			taskKind: req.kind,
			request: { vendor: v, request: req },
			upstreamResponse: {
				status:
					typeof err?.status === "number"
						? err.status
						: Number.isFinite(Number(err?.status))
							? Number(err.status)
							: null,
				error: {
					message,
					code: typeof err?.code === "string" ? err.code : null,
					details: err?.details ?? null,
				},
			},
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: failedVendor,
			taskKind: req.kind,
			result: failedResult,
			durationMs: Date.now() - startedAtMs,
		});

		setTraceStage(c, "task:run:error", {
			vendor: failedVendor,
			taskKind: req.kind,
			message: String(message || "").slice(0, 300),
		});
		emitProgress(userId, progressCtx, {
			status: "failed",
			progress: 0,
			message,
			taskId: failedTaskId,
			raw: (failedResult as any).raw,
		});
		throw err;
	}
}
