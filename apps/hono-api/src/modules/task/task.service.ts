import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { getPrismaClient } from "../../platform/node/prisma";
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
import { stageTaskAssetsForAsyncHosting } from "../asset/asset.hosting";
import { ensureModelCatalogSchema } from "../model-catalog/model-catalog.repo";
import {
	buildMappedUpstreamRequest,
	parseMappedTaskResultFromPayload,
	resolveEnabledModelCatalogMappingForTask,
} from "./task.mappings";
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
} from "./vendor-call-logs.repo";
import {
	bindTeamCreditsReservationToTaskId,
	requireSufficientTeamCredits,
	releaseTeamCreditsOnFailure,
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
	recordVendorCallsForTaskResult,
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
	extractChannelVendor,
	isApimartBaseUrl,
	isGrsaiBaseUrl,
	isYunwuBaseUrl,
	normalizeApimartBaseUrl,
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
import { submitDreaminaTask } from "../dreamina/dreamina.service";

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

export async function enqueueStoredTaskForVendorAttempts(
	c: AppContext,
	userId: string,
	inputAttempts: Array<{ vendor: string; request: TaskRequestDto }>,
	options?: { taskId?: string | null },
): Promise<TaskResult> {
	const attempts = (() => {
		const out: Array<{ vendorKey: string; request: TaskRequestDto }> = [];
		const seen = new Set<string>();
		for (const attempt of inputAttempts) {
			const vendorKey = normalizeVendorKey(attempt?.vendor || "");
			if (!vendorKey || vendorKey === "auto") continue;
			if (seen.has(vendorKey)) continue;
			seen.add(vendorKey);
			if (!attempt?.request?.kind) continue;
			out.push({ vendorKey, request: attempt.request });
		}
		return out;
	})();

	if (!attempts.length) {
		throw new AppError("No vendor candidates for stored task", {
			status: 400,
			code: "vendor_required",
		});
	}

	const taskId = resolveStoredTaskId(options);
	const nowIso = new Date().toISOString();
	const kind = attempts[0]!.request.kind;
	const refKind = resolveStoredTaskRefKind(kind);

	const initialVendorKey = attempts[0]!.vendorKey;
	const vendorCandidates = attempts.map((a) => a.vendorKey);
	const initial = buildStoredQueuedTaskResult({
		taskId,
		kind,
		vendor: initialVendorKey,
		enqueuedAt: nowIso,
		rawExtra: { vendorCandidates },
	});

	await persistStoredTaskResult(c, {
		userId,
		taskId,
		vendor: initialVendorKey,
		kind,
		result: initial,
		nowIso,
	});

	await upsertStoredTaskRefSafely(c, {
		userId,
		refKind,
		taskId,
		vendor: initialVendorKey,
		nowIso,
		warnTag: "upsert async task ref failed",
	});

	// Make pending tasks visible in /tasks/logs immediately.
	await recordVendorCallPayloads(c, {
		userId,
		vendor: initialVendorKey,
		taskId,
			taskKind: kind,
			request: {
				vendor: "auto",
				request: attempts[0]!.request,
				vendorCandidates,
			},
		});
	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: initialVendorKey,
		taskKind: kind,
		result: initial,
	});

	const runInBackground = async () => {
		const startedAtMs = Date.now();
		let lastErr: any = null;
		let lastFailed: { vendorKey: string; result: TaskResult } | null = null;

		try {
			const startedIso = new Date().toISOString();
			const runningBase = buildStoredRunningTaskResult({
				initial,
				startedAt: startedIso,
			});

			await persistStoredTaskResult(c, {
				userId,
				taskId,
				vendor: initialVendorKey,
				kind,
				result: runningBase,
				nowIso: startedIso,
			});
			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: initialVendorKey,
				taskKind: kind,
				result: runningBase,
			});

			for (let i = 0; i < attempts.length; i += 1) {
				const attempt = attempts[i]!;
				const vendorKey = attempt.vendorKey;

				const running = buildStoredRunningTaskResult({
					initial: runningBase,
					startedAt: startedIso,
					rawExtra: {
						vendor: vendorKey,
						attempt: { index: i, total: attempts.length },
					},
				});

				await persistStoredTaskResult(c, {
					userId,
					taskId,
					vendor: vendorKey,
					kind,
					result: running,
					nowIso: new Date().toISOString(),
				});

				await recordVendorCallPayloads(c, {
					userId,
					vendor: vendorKey,
					taskId,
					taskKind: kind,
					request: { vendor: vendorKey, request: attempt.request },
				});
				await recordVendorCallForTaskResult(c, {
					userId,
					vendor: vendorKey,
					taskKind: kind,
					result: running,
				});

				try {
					const result = await runGenericTaskForVendor(
						c,
						userId,
						vendorKey,
						attempt.request,
						{ forceTaskId: taskId },
					);

					if (result?.status === "failed") {
						lastFailed = { vendorKey, result };
						continue;
					}

					const completedAt =
						result.status === "succeeded" ? new Date().toISOString() : null;
					await persistStoredTaskResult(c, {
						userId,
						taskId,
						vendor: vendorKey,
						kind,
						result,
						completedAt,
						nowIso: completedAt || new Date().toISOString(),
					});
					await upsertStoredTaskRefSafely(c, {
						userId,
						refKind,
						taskId,
						vendor: vendorKey,
						nowIso: completedAt || new Date().toISOString(),
						warnTag: "update async task ref failed",
					});
					return;
				} catch (err: any) {
					lastErr = err;

						const failedAttempt = buildStoredFailedTaskResult({
							taskId,
							kind,
							vendor: vendorKey,
							err,
							rawExtra: { attempt: { index: i, total: attempts.length } },
						});

					try {
						await recordVendorCallForTaskResult(c, {
							userId,
							vendor: vendorKey,
							taskKind: kind,
							result: failedAttempt,
							durationMs: Date.now() - startedAtMs,
						});
					} catch (logErr: any) {
						console.warn(
							"[vendor-call-logs] record failed attempt failed",
							logErr?.message || logErr,
						);
					}
					continue;
				}
			}

			// Exhausted candidates: persist the last failed TaskResult if available.
			if (lastFailed) {
				const completedAt = new Date().toISOString();
				await persistStoredTaskResult(c, {
					userId,
					taskId,
					vendor: lastFailed.vendorKey,
					kind,
					result: lastFailed.result,
					completedAt,
					nowIso: completedAt,
				});
				await upsertStoredTaskRefSafely(c, {
					userId,
					refKind,
					taskId,
					vendor: lastFailed.vendorKey,
					nowIso: completedAt,
					warnTag: "update async task ref failed",
				});
				return;
			}
		} catch (err: any) {
			lastErr = err;
		}

		const completedAt = new Date().toISOString();
		const failed = buildStoredFailedTaskResult({
			taskId,
			kind,
			vendor: initialVendorKey,
			err: lastErr,
			rawExtra: { vendorCandidates },
		});

		try {
			await persistStoredTaskResult(c, {
				userId,
				taskId,
				vendor: initialVendorKey,
				kind,
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
			vendor: initialVendorKey,
			taskKind: kind,
			result: failed,
			durationMs: Date.now() - startedAtMs,
		});
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

// ---------- APIMART ----------

export async function runApimartTextTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	if (req.kind !== "chat" && req.kind !== "prompt_refine") {
		throw new AppError("apimart 仅支持 chat/prompt_refine", {
			status: 400,
			code: "invalid_task_kind",
		});
	}

	const modelKeyRaw =
		pickModelKey(req, { modelKey: undefined }) ||
		(await resolveDefaultModelKeyFromCatalogForVendor(c, "apimart", "text")) ||
		"models/gemini-2.5-pro";
	const modelKey = modelKeyRaw.startsWith("models/")
		? modelKeyRaw
		: `models/${modelKeyRaw}`;
	const modelId = modelKey.startsWith("models/") ? modelKey.slice(7) : modelKey;

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: modelId,
	});
	const progressCtx = extractProgressContext(req, "apimart");
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "apimart",
		modelKey: modelId,
	});
	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

	const startedAtMs = Date.now();
	const taskId = `apimart-${Date.now().toString(36)}`;
	const vendorForLog = `apimart-${modelId}`;

	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: vendorForLog,
		taskKind: req.kind,
		result: TaskResultSchema.parse({
			id: taskId,
			kind: req.kind,
			status: "queued",
			assets: [],
			raw: { vendor: vendorForLog },
		}),
	});

	try {
		const ctx = await resolveVendorContext(c, userId, "apimart");
		const { baseUrl, apiKey } = resolveRequiredVendorHttpContext(ctx, {
			fallbackBaseUrl: "https://api.apimart.ai",
			errorMessage: "未配置 apimart API Key",
			errorCode: "apimart_api_key_missing",
		});

		const systemPrompt =
			req.kind === "prompt_refine"
				? pickSystemPrompt(
						req,
						"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
					)
				: pickSystemPrompt(req, "请用中文回答。");

		const contents: any[] = [];
		if (systemPrompt) {
			contents.push({ role: "user", parts: [{ text: systemPrompt }] });
		}
		contents.push({ role: "user", parts: [{ text: req.prompt }] });

		const url = `${normalizeApimartBaseUrl(baseUrl)}/v1beta/${modelKey}:generateContent`;
		const body = { contents };

		emitProgress(userId, progressCtx, { status: "running", progress: 10, taskId });
		await recordVendorCallPayloads(c, {
			userId,
			vendor: vendorForLog,
			taskId,
			taskKind: req.kind,
			request: { url, body },
		});

		const wrapper = await callJsonApi(
			c,
			url,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ provider: "apimart" },
		);
		await recordVendorCallPayloads(c, {
			userId,
			vendor: vendorForLog,
			taskId,
			taskKind: req.kind,
			upstreamResponse: { url, data: wrapper },
		});

		if (typeof wrapper?.code === "number" && wrapper.code !== 200) {
			throw new AppError(
				(wrapper?.error?.message ||
					wrapper?.message ||
					`apimart 文本生成失败: code ${wrapper.code}`) as string,
				{
					status: 502,
					code: "apimart_request_failed",
					details: { upstreamData: wrapper ?? null, requestBody: body },
				},
			);
		}

		const payload = wrapper?.data ?? wrapper;
		const firstCandidate = Array.isArray(payload?.candidates)
			? payload.candidates[0]
			: null;
		const parts = Array.isArray(firstCandidate?.content?.parts)
			? firstCandidate.content.parts
			: [];
		const text = parts
			.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
			.join("")
			.trim();

		const result = TaskResultSchema.parse({
			id: taskId,
			kind: req.kind,
			status: "succeeded",
			assets: [],
			raw: {
				provider: "apimart",
				model: modelId,
				response: wrapper ?? null,
				text,
			},
		});
		await bindReservationToTaskId(c, userId, reservation, taskId);
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind: req.kind,
			result,
			durationMs: Date.now() - startedAtMs,
		});
		emitProgress(userId, progressCtx, {
			status: "succeeded",
			progress: 100,
			taskId,
			raw: result.raw,
		});
		return result;
	} catch (err) {
		emitProgress(userId, progressCtx, {
			status: "failed",
			progress: 0,
			taskId,
			message: typeof (err as any)?.message === "string" ? (err as any).message : "任务执行失败",
		});
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

export async function runApimartImageToPromptTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	if (req.kind !== "image_to_prompt") {
		throw new AppError("apimart 仅支持 image_to_prompt", {
			status: 400,
			code: "invalid_task_kind",
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

	const modelKeyRaw =
		pickModelKey(req, { modelKey: undefined }) ||
		(await resolveDefaultModelKeyFromCatalogForVendor(c, "apimart", "text")) ||
		"models/gemini-2.5-pro";
	const modelKey = modelKeyRaw.startsWith("models/")
		? modelKeyRaw
		: `models/${modelKeyRaw}`;
	const modelId = modelKey.startsWith("models/") ? modelKey.slice(7) : modelKey;

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: modelId,
	});
	const progressCtx = extractProgressContext(req, "apimart");
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "apimart",
		modelKey: modelId,
	});
	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

	const startedAtMs = Date.now();
	const taskId = `apimart-vsn-${Date.now().toString(36)}`;
	const vendorForLog = `apimart-${modelId}`;

	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: vendorForLog,
		taskKind: req.kind,
		result: TaskResultSchema.parse({
			id: taskId,
			kind: req.kind,
			status: "queued",
			assets: [],
			raw: { vendor: vendorForLog },
		}),
	});

	try {
		const ctx = await resolveVendorContext(c, userId, "apimart");
		const { baseUrl, apiKey } = resolveRequiredVendorHttpContext(ctx, {
			fallbackBaseUrl: "https://api.apimart.ai",
			errorMessage: "未配置 apimart API Key",
			errorCode: "apimart_api_key_missing",
		});

		const systemPrompt = pickSystemPrompt(
			req,
			"You are an expert prompt engineer. When a user provides an image, you must follow the user's instruction strictly and produce the requested output. If the user asks for a recreatable prompt, describe subject, environment, composition, camera, lighting, and style cues.",
		);

		const temperature =
			typeof extras.temperature === "number" && Number.isFinite(extras.temperature)
				? extras.temperature
				: null;

		const dataUrl = await resolveSora2ApiImageUrl(c, imageData || imageUrl!);
		const match = String(dataUrl || "").trim().match(/^data:([^;]+);base64,(.+)$/i);
		if (!match) {
			throw new AppError("参考图无法解析为 data:image/*;base64", {
				status: 400,
				code: "invalid_image_data",
				details: { imageUrl: imageUrl || null },
			});
		}
		const mimeType = String(match[1] || "").trim() || "application/octet-stream";
		const base64 = String(match[2] || "").replace(/\s+/g, "");
		if (!/^image\//i.test(mimeType) || !base64) {
			throw new AppError("参考图无法解析为有效的 image/* base64", {
				status: 400,
				code: "invalid_image_data",
				details: { mimeType, imageUrl: imageUrl || null },
			});
		}

		const contents: any[] = [];
		if (systemPrompt) {
			contents.push({ role: "user", parts: [{ text: systemPrompt }] });
		}
		contents.push({
			role: "user",
			parts: [
				{ inlineData: { mimeType, data: base64 } },
				{ text: req.prompt },
			],
		});

		const body: any = {
			contents,
			...(temperature !== null ? { generationConfig: { temperature } } : {}),
		};

		const redactedContents = contents.map((item) => {
			if (!item || typeof item !== "object") return item;
			const parts = Array.isArray((item as any).parts) ? (item as any).parts : [];
			const redactedParts = parts.map((part: any) => {
				if (!part || typeof part !== "object") return part;
				const inlineData = (part as any).inlineData;
				if (
					inlineData &&
					typeof inlineData === "object" &&
					typeof inlineData.data === "string" &&
					inlineData.data
				) {
					return {
						...part,
						inlineData: {
							...inlineData,
							data: `[omitted len=${inlineData.data.length}]`,
							previewDataUrl: `data:${typeof inlineData.mimeType === "string" && inlineData.mimeType.trim() ? inlineData.mimeType.trim() : "image/jpeg"};base64,${String(inlineData.data).replace(/\s+/g, "")}`,
						},
					};
				}
				return part;
			});
			return { ...item, parts: redactedParts };
		});

		const url = `${normalizeApimartBaseUrl(baseUrl)}/v1beta/${modelKey}:generateContent`;

		emitProgress(userId, progressCtx, { status: "running", progress: 10, taskId });
		await recordVendorCallPayloads(c, {
			userId,
			vendor: vendorForLog,
			taskId,
			taskKind: req.kind,
			request: { url, body: { ...body, contents: redactedContents } },
		});

		const wrapper = await callJsonApi(
			c,
			url,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ provider: "apimart" },
		);
		await recordVendorCallPayloads(c, {
			userId,
			vendor: vendorForLog,
			taskId,
			taskKind: req.kind,
			upstreamResponse: { url, data: wrapper },
		});

		if (typeof wrapper?.code === "number" && wrapper.code !== 200) {
			throw new AppError(
				(wrapper?.error?.message ||
					wrapper?.message ||
					`apimart 图像理解失败: code ${wrapper.code}`) as string,
				{
					status: 502,
					code: "apimart_request_failed",
					details: { upstreamData: wrapper ?? null },
				},
			);
		}

		const payload = wrapper?.data ?? wrapper;
		const firstCandidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
		const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : [];
		const text = parts
			.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
			.join("")
			.trim();

		const result = TaskResultSchema.parse({
			id: taskId,
			kind: "image_to_prompt",
			status: "succeeded",
			assets: [],
			raw: {
				provider: "apimart",
				model: modelId,
				response: wrapper ?? null,
				text,
				imageUrl: imageUrl || null,
				imageDataLength: imageData ? imageData.length : 0,
			},
		});
		await bindReservationToTaskId(c, userId, reservation, taskId);
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind: req.kind,
			result,
			durationMs: Date.now() - startedAtMs,
		});
		emitProgress(userId, progressCtx, {
			status: "succeeded",
			progress: 100,
			taskId,
			raw: result.raw,
		});
		return result;
	} catch (err) {
		emitProgress(userId, progressCtx, {
			status: "failed",
			progress: 0,
			taskId,
			message: typeof (err as any)?.message === "string" ? (err as any).message : "任务执行失败",
		});
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

export async function runApimartVideoTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const extras = (req.extras || {}) as Record<string, any>;
	const model = (() => {
		const raw = typeof extras.modelKey === "string" ? extras.modelKey.trim() : "";
		if (!raw) return null;
		return raw.startsWith("models/") ? raw.slice(7) : raw;
	})();
	if (!model) {
		throw new AppError("apimart 需要通过 extras.modelKey 指定模型", {
			status: 400,
			code: "apimart_model_key_missing",
		});
	}

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const progressCtx = extractProgressContext(req, "apimart");

	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "apimart",
		modelKey: model,
	});
	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

	try {
		const ctx = await resolveVendorContext(c, userId, "apimart");
		const { baseUrl, apiKey } = resolveRequiredVendorHttpContext(ctx, {
			fallbackBaseUrl: "https://api.apimart.ai",
			errorMessage: "未配置 apimart API Key",
			errorCode: "apimart_api_key_missing",
		});

		const aspectRatio =
			typeof extras.aspectRatio === "string" && extras.aspectRatio.trim()
				? extras.aspectRatio.trim()
				: "16:9";
		const durationSeconds = (() => {
			const raw =
				typeof extras.durationSeconds === "number"
					? extras.durationSeconds
					: typeof extras.duration === "number"
						? extras.duration
						: null;
			return typeof raw === "number" && Number.isFinite(raw) && raw > 0
				? raw
				: undefined;
		})();

		const firstFrameUrl =
			typeof extras.firstFrameUrl === "string" && extras.firstFrameUrl.trim()
				? extras.firstFrameUrl.trim()
				: undefined;
		const lastFrameUrl =
			typeof extras.lastFrameUrl === "string" && extras.lastFrameUrl.trim()
				? extras.lastFrameUrl.trim()
				: undefined;

		const imageUrls = (() => {
			const urls: string[] = [];
			const pushAll = (value: any) => {
				const arr = Array.isArray(value) ? value : [value];
				for (const item of arr) {
					if (typeof item === "string" && item.trim()) urls.push(item.trim());
				}
			};
			pushAll((extras as any).image_urls);
			pushAll((extras as any).imageUrls);
			pushAll((extras as any).url);
			pushAll((extras as any).urls);
			pushAll((extras as any).referenceImages);
			pushAll((extras as any).reference_images);
			if (firstFrameUrl) urls.push(firstFrameUrl);
			if (lastFrameUrl) urls.push(lastFrameUrl);
			return Array.from(new Set(urls)).slice(0, 14);
		})();

		const body: Record<string, any> = {
			model,
			prompt: req.prompt,
			aspect_ratio: aspectRatio,
			...(typeof durationSeconds === "number" ? { duration: durationSeconds } : {}),
			...(typeof extras.private === "boolean" ? { private: extras.private } : {}),
			...(typeof extras.watermark === "boolean" ? { watermark: extras.watermark } : {}),
			...(typeof extras.thumbnail === "boolean" ? { thumbnail: extras.thumbnail } : {}),
			...(imageUrls.length ? { image_urls: imageUrls } : {}),
		};

		emitProgress(userId, progressCtx, { status: "running", progress: 5 });

		const data = await callJsonApi(
			c,
			`${normalizeApimartBaseUrl(baseUrl)}/v1/videos/generations`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ provider: "apimart" },
		);

		if (typeof data?.code === "number" && data.code !== 200) {
			throw new AppError(
				(data?.error?.message ||
					data?.message ||
					`apimart 视频生成失败: code ${data.code}`) as string,
				{
					status: 502,
					code: "apimart_request_failed",
					details: { upstreamData: data ?? null, requestBody: body },
				},
			);
		}

		const first = Array.isArray(data?.data) ? data.data[0] : null;
		const taskId =
			(typeof first?.task_id === "string" && first.task_id.trim()) ||
			(typeof first?.taskId === "string" && first.taskId.trim()) ||
			null;
		if (!taskId) {
			throw new AppError("apimart 未返回 task_id", {
				status: 502,
				code: "apimart_task_id_missing",
				details: { upstreamData: data ?? null, requestBody: body },
			});
		}

		emitProgress(userId, progressCtx, {
			status: "queued",
			progress: 10,
			taskId,
			raw: data ?? null,
		});

		await upsertVendorTaskRefWithWarn(c, {
			userId,
			kind: "video",
			taskId: taskId.trim(),
			vendor: "apimart",
			warnTag: "upsert apimart ref failed",
		});

		const result = TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "queued",
			assets: [],
			raw: {
				provider: "apimart",
				model,
				taskId,
				status: "queued",
				request: body,
				response: data ?? null,
			},
		});
		await bindReservationToTaskId(c, userId, reservation, taskId);
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: "apimart",
			taskKind: req.kind,
			result,
		});
		return result;
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

export async function runApimartImageTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
	options?: { forceTaskId?: string | null },
): Promise<TaskResult> {
	if (req.kind !== "text_to_image" && req.kind !== "image_edit") {
		throw new AppError("apimart 仅支持 text_to_image/image_edit 或 text_to_video", {
			status: 400,
			code: "invalid_task_kind",
		});
	}

	const forcedTaskId =
		typeof options?.forceTaskId === "string" && options.forceTaskId.trim()
			? options.forceTaskId.trim()
			: null;
	const extras = (req.extras || {}) as Record<string, any>;
	const rawModelKey =
		typeof extras.modelKey === "string" && extras.modelKey.trim()
			? extras.modelKey.trim()
			: "";
	const modelKey =
		rawModelKey && rawModelKey.startsWith("models/")
			? rawModelKey.slice(7)
			: rawModelKey;

		const normalizedMaybeBanana = normalizeBananaModelKey(modelKey);
		const resolved = (() => {
			if (normalizedMaybeBanana && BANANA_MODELS.has(normalizedMaybeBanana)) {
				return {
					modelForApimart: mapBananaModelToApimartModelKey(normalizedMaybeBanana),
					modelForBilling: normalizedMaybeBanana,
				};
			}
			const fallback = "gemini-2.5-flash-image-preview";
			const trimmed = modelKey.trim();
			return {
				modelForApimart: trimmed || fallback,
				modelForBilling: trimmed || fallback,
			};
		})();

		{
			const m = (resolved.modelForApimart || "").trim().toLowerCase();
			const looksLikeVideoModel =
				!!m &&
				(m.includes("veo") ||
					m.includes("kling") ||
					m.includes("sora") ||
					m.includes("hailuo") ||
					m.includes("video"));
			if (looksLikeVideoModel) {
				throw new AppError("apimart 图像任务不支持该模型（疑似视频模型）", {
					status: 400,
					code: "apimart_model_kind_mismatch",
					details: {
						taskKind: req.kind,
						modelKey: modelKey || null,
						modelForApimart: resolved.modelForApimart || null,
					},
				});
			}
		}

		const required = await resolveTeamCreditsCostForTask(c, {
			taskKind: req.kind,
			modelKey: resolved.modelForBilling,
		});
	const progressCtx = extractProgressContext(req, "apimart");

	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "apimart",
		modelKey: resolved.modelForBilling,
	});
	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });

	try {
		const ctx = await resolveVendorContext(c, userId, "apimart");
		const { baseUrl, apiKey } = resolveRequiredVendorHttpContext(ctx, {
			fallbackBaseUrl: "https://api.apimart.ai",
			errorMessage: "未配置 apimart API Key",
			errorCode: "apimart_api_key_missing",
		});

		const referenceImages = (() => {
			const urls: string[] = [];
			const pushAll = (value: any) => {
				const arr = Array.isArray(value) ? value : [value];
				for (const item of arr) {
					if (typeof item === "string" && item.trim()) urls.push(item.trim());
				}
			};
			pushAll((extras as any).image_urls);
			pushAll((extras as any).imageUrls);
			pushAll((extras as any).urls);
			pushAll((extras as any).referenceImages);
			pushAll((extras as any).reference_images);
			pushAll((extras as any).image);
			pushAll((extras as any).url);
			return Array.from(new Set(urls)).slice(0, 14);
		})();

		if (req.kind === "image_edit" && referenceImages.length === 0) {
			throw new AppError(
				"image_edit 需要提供参考图 URL（extras.referenceImages 或 image_urls/imageUrls/urls）",
				{
					status: 400,
					code: "reference_images_missing",
					details: {
						vendor: "apimart",
						extrasKeys: Object.keys(extras || {}).sort(),
					},
				},
			);
		}

		const aspectRatio =
			typeof extras.aspectRatio === "string" && extras.aspectRatio.trim()
				? extras.aspectRatio.trim()
				: "auto";
		const resolvedAspect = (() => {
			const raw =
				typeof aspectRatio === "string" && aspectRatio.trim()
					? aspectRatio.trim()
					: "";
			if (!raw || raw.toLowerCase() === "auto") return null;
			const allowed = new Set([
				"4:3",
				"3:4",
				"16:9",
				"9:16",
				"2:3",
				"3:2",
				"1:1",
				"4:5",
				"5:4",
				"21:9",
			]);
			return allowed.has(raw) ? raw : null;
		})();

		const resolution =
			typeof extras.resolution === "string" && extras.resolution.trim()
				? extras.resolution.trim()
				: typeof (extras as any).imageResolution === "string" &&
						String((extras as any).imageResolution).trim()
					? String((extras as any).imageResolution).trim()
					: typeof extras.imageSize === "string" && extras.imageSize.trim()
						? extras.imageSize.trim()
						: typeof (extras as any).image_size === "string" &&
									String((extras as any).image_size).trim()
								? String((extras as any).image_size).trim()
					: null;

		const n = (() => {
			const raw =
				typeof extras.variants === "number"
					? extras.variants
					: typeof extras.n === "number"
						? extras.n
						: null;
			if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
			return Math.max(1, Math.min(8, Math.round(raw)));
		})();

		const body: Record<string, any> = {
			model: resolved.modelForApimart,
			prompt: req.prompt,
			n,
			...(resolvedAspect ? { size: resolvedAspect } : {}),
			...(resolution ? { resolution } : {}),
			...(referenceImages.length
				? { image_urls: referenceImages.slice(0, 14) }
				: {}),
		};

		emitProgress(userId, progressCtx, { status: "running", progress: 5 });

		const data = await callJsonApi(
			c,
			`${normalizeApimartBaseUrl(baseUrl)}/v1/images/generations`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ provider: "apimart" },
		);

		if (typeof data?.code === "number" && data.code !== 200) {
			throw new AppError(
				(data?.error?.message ||
					data?.message ||
					`apimart 图像生成失败: code ${data.code}`) as string,
				{
					status: 502,
					code: "apimart_request_failed",
					details: { upstreamData: data ?? null, requestBody: body },
				},
			);
		}

		const first = Array.isArray(data?.data) ? data.data[0] : null;
			const taskId =
				(typeof first?.task_id === "string" && first.task_id.trim()) ||
				(typeof first?.taskId === "string" && first.taskId.trim()) ||
				null;
			if (!taskId) {
				throw new AppError("apimart 未返回 task_id", {
					status: 502,
					code: "apimart_task_id_missing",
					details: { upstreamData: data ?? null, requestBody: body },
				});
			}

			const taskIdForClient = forcedTaskId || taskId;

			emitProgress(userId, progressCtx, {
				status: "queued",
				progress: 10,
				taskId: taskIdForClient,
				raw: data ?? null,
			});

			await upsertVendorTaskRefWithWarn(c, {
				userId,
				kind: "image",
				taskId: taskIdForClient.trim(),
				vendor: "apimart",
				pid: forcedTaskId ? taskId.trim() : undefined,
				warnTag: "upsert apimart image ref failed",
			});

			const result = TaskResultSchema.parse({
				id: taskIdForClient,
				kind: req.kind,
				status: "queued",
				assets: [],
				raw: {
					provider: "apimart",
					model: resolved.modelForApimart,
					taskId,
					status: "queued",
					...(forcedTaskId ? { upstreamTaskId: taskId.trim(), taskStoreId: taskIdForClient } : {}),
					request: body,
					response: data ?? null,
				},
			});
			await bindReservationToTaskId(c, userId, reservation, taskIdForClient);
			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: "apimart",
				taskKind: req.kind,
			result,
		});
		return result;
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

export async function fetchApimartTaskResult(
	c: AppContext,
	userId: string,
	taskId: string,
	promptFromClient?: string | null,
	options?: { taskKind?: TaskRequestDto["kind"] | null },
) {
	if (!taskId || !taskId.trim()) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "task_id_required",
		});
	}

	const expectedTaskKind =
		typeof options?.taskKind === "string" && options.taskKind.trim()
			? options.taskKind.trim()
			: null;
	{
		const mapped = await fetchMappedTaskResultForVendor(c, userId, "apimart", {
			taskId,
			taskKind: expectedTaskKind as TaskRequestDto["kind"] | null,
			kindHint:
				expectedTaskKind === "text_to_video" || expectedTaskKind === "image_to_video"
					? "video"
					: expectedTaskKind === "text_to_image" || expectedTaskKind === "image_edit"
						? "image"
						: null,
			promptFromClient: promptFromClient ?? null,
		});
		if (mapped) return mapped;
	}
	const refKindCandidates: Array<"image" | "video"> = (() => {
		if (expectedTaskKind === "text_to_image" || expectedTaskKind === "image_edit") return ["image"];
		if (expectedTaskKind === "text_to_video" || expectedTaskKind === "image_to_video") return ["video"];
		return ["video", "image"];
	})();

	const refForTask = await (async () => {
		for (const k of refKindCandidates) {
			try {
				const ref = await getVendorTaskRefByTaskId(c.env.DB, userId, k, taskId);
				if (ref) return ref;
			} catch {
				// ignore
			}
		}
		return null;
	})();

	const pid = typeof refForTask?.pid === "string" ? refForTask.pid.trim() : "";
	const upstreamTaskId = pid || taskId.trim();

	const ctx = await resolveVendorContext(c, userId, "apimart");
	const { baseUrl, apiKey } = resolveRequiredVendorHttpContext(ctx, {
		fallbackBaseUrl: "https://api.apimart.ai",
		errorMessage: "未配置 apimart API Key",
		errorCode: "apimart_api_key_missing",
	});

	const pollUrl = `${normalizeApimartBaseUrl(baseUrl)}/v1/tasks/${encodeURIComponent(
		upstreamTaskId,
	)}?language=zh`;

	let wrapper: any;
	try {
		wrapper = await callJsonApi(
			c,
			pollUrl,
			{
				method: "GET",
				headers: { Authorization: `Bearer ${apiKey}` },
			},
			{ provider: "apimart" },
		);
	} catch (err: any) {
		await recordVendorCallPayloads(c, {
			userId,
			vendor: "apimart",
			taskId,
			taskKind: expectedTaskKind,
			upstreamResponse: {
				url: pollUrl,
				error: {
					message:
						typeof err?.message === "string" ? err.message : String(err),
					status:
						typeof err?.status === "number"
							? err.status
							: Number.isFinite(Number(err?.status))
								? Number(err.status)
								: null,
					code: typeof err?.code === "string" ? err.code : null,
					details: err?.details ?? null,
				},
			},
		});
		throw err;
	}

	if (typeof wrapper?.code === "number" && wrapper.code !== 200) {
		await recordVendorCallPayloads(c, {
			userId,
			vendor: "apimart",
			taskId,
			taskKind: expectedTaskKind,
			upstreamResponse: { url: pollUrl, wrapper: wrapper ?? null },
		});
		throw new AppError(
			(wrapper?.error?.message ||
				wrapper?.message ||
				`apimart 任务查询失败: code ${wrapper.code}`) as string,
			{
				status: 502,
				code: "apimart_result_failed",
				details: { upstreamData: wrapper ?? null },
			},
		);
	}

	const payload =
		wrapper && typeof wrapper === "object" && wrapper.data ? wrapper.data : wrapper ?? {};
	let status = normalizeApimartTaskStatus(payload?.status);
	const progress = clampProgress(
		typeof payload?.progress === "number" ? payload.progress : undefined,
	);

	const expected = typeof options?.taskKind === "string" ? options.taskKind : null;
	const preferImages =
		expected === "text_to_image" || expected === "image_edit";
	const preferVideos =
		expected === "text_to_video" || expected === "image_to_video";

	const imageUrls = extractApimartMediaUrls(payload, "images");
	const videoUrls = extractApimartMediaUrls(payload, "videos");

	const mediaKey: "images" | "videos" = (() => {
		if (preferImages) return "images";
		if (preferVideos) return "videos";
		if (imageUrls.length > 0 && videoUrls.length === 0) return "images";
		if (videoUrls.length > 0 && imageUrls.length === 0) return "videos";
		return "videos";
	})();

	const urls = mediaKey === "images" ? imageUrls : videoUrls;
	const thumbnailUrl =
		mediaKey === "videos" ? extractApimartThumbnailUrl(payload) : null;
	if (status === "succeeded" && urls.length === 0) {
		status = "running";
	}

	const taskKind: TaskRequestDto["kind"] = (() => {
		if (preferImages) return expected as TaskRequestDto["kind"];
		if (preferVideos) return "text_to_video";
		if (mediaKey === "images") return (expected as any) || "text_to_image";
		return "text_to_video";
	})();

	if (status === "succeeded" && urls.length > 0) {
		const assets =
			mediaKey === "images"
				? urls.map((url) =>
						TaskAssetSchema.parse({ type: "image", url, thumbnailUrl: null }),
					)
				: [
						TaskAssetSchema.parse({
							type: "video",
							url: urls[0]!,
							thumbnailUrl: thumbnailUrl,
						}),
					];

		const stagedAssets = await stageTaskAssetsForAsyncHosting({
			c,
			userId,
			assets,
			meta: {
				taskKind,
				prompt:
					typeof promptFromClient === "string" && promptFromClient.trim()
						? promptFromClient.trim()
						: null,
				vendor: "apimart",
				taskId: taskId ?? null,
			},
		});

		const result = TaskResultSchema.parse({
			id: taskId,
			kind: taskKind,
			status: "succeeded",
			assets: stagedAssets,
			raw: {
				provider: "apimart",
				response: payload,
				...(pid ? { upstreamTaskId, taskStoreId: taskId } : {}),
				hosting: { status: "pending", mode: "async" },
			},
		});
		await recordVendorCallPayloads(c, {
			userId,
			vendor: "apimart",
			taskId,
			taskKind,
			upstreamResponse: { url: pollUrl, wrapper: wrapper ?? null },
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: "apimart",
			taskKind,
			result,
		});
		return result;
	}

	const failureReasonRaw =
		(typeof payload?.error?.message === "string" && payload.error.message.trim()) ||
		(typeof wrapper?.error?.message === "string" && wrapper.error.message.trim()) ||
		null;

	const result = TaskResultSchema.parse({
		id: taskId,
		kind: taskKind,
		status,
		assets: [],
		raw: {
			provider: "apimart",
			response: payload,
			progress,
			...(pid ? { upstreamTaskId, taskStoreId: taskId } : {}),
			failureReason: failureReasonRaw,
			wrapper: wrapper ?? null,
		},
	});

	if (result.status === "failed") {
		try {
			const requestId = (() => {
				try {
					const v = (c as any)?.get?.("requestId");
					return typeof v === "string" && v.trim() ? v.trim() : null;
				} catch {
					return null;
				}
			})();
			console.warn(
				JSON.stringify({
					ts: new Date().toISOString(),
					type: "vendor_task_failed",
					requestId,
					vendor: "apimart",
					taskId,
					upstreamTaskId,
					taskKind,
					failureReason: failureReasonRaw,
				}),
			);
		} catch {
			// ignore
		}
	}

	if (result.status === "succeeded" || result.status === "failed") {
		await recordVendorCallPayloads(c, {
			userId,
			vendor: "apimart",
			taskId,
			taskKind,
			upstreamResponse: { url: pollUrl, wrapper: wrapper ?? null },
		});
	}
	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: "apimart",
		taskKind,
		result,
	});
	return result;
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

	const ctx = await resolveVendorContext(c, userId, "sora2api");
	const baseUrl =
		normalizeBaseUrl(ctx.baseUrl) || "http://localhost:8000";
	const isApimartBase =
		isApimartBaseUrl(baseUrl) || ctx.viaProxyVendor === "apimart";
	const isYunwuBase =
		isYunwuBaseUrl(baseUrl) || ctx.viaProxyVendor === "yunwu";
	const isGrsaiBase =
		isGrsaiBaseUrl(baseUrl) || ctx.viaProxyVendor === "grsai";
	const isComflyProxy = ctx.viaProxyVendor === "comfly";
		const apiKey = ctx.apiKey.trim();
		if (!apiKey) {
			throw new AppError(
				resolveImageVendorApiKeyMissingMessage({ isApimartBase, isYunwuBase }),
				{
					status: 400,
					code: "sora2api_api_key_missing",
				},
			);
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
		: isGrsaiBase || isYunwuBase
			? modelKeyRaw || "sora-2"
			: normalizeSora2ApiModelKey(modelKeyRaw || undefined, orientation, durationSeconds);
	const billingModelKey = modelKeyRaw || model;
	const billingSpecKey = extractBillingSpecKeyFromTaskRequest(req);
	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: billingModelKey,
		specKey: billingSpecKey,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "sora2api",
		modelKey: billingModelKey,
		specKey: billingSpecKey,
	});

	emitProgress(userId, progressCtx, { status: "queued", progress: 0 });
	try {
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
		const result = await createComflySora2VideoTask(
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
		const billedResult = attachBillingSpecKeyToTaskResult(result, billingSpecKey);
		await bindReservationToTaskId(c, userId, reservation, billedResult.id);
		const vendorForRef = `comfly-${model || "sora-2"}`;
		await upsertVendorTaskRefWithWarn(c, {
			userId,
			kind: "video",
			taskId: billedResult.id,
			vendor: vendorForRef,
			warnTag: "upsert comfly video ref failed",
		});
		{
			const vendorForLog = `comfly-${model || "sora-2"}`;
			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: vendorForLog,
				taskKind: "text_to_video",
				result: billedResult,
			});
		}
		return billedResult;
	}

	if (isYunwuBase) {
		emitProgress(userId, progressCtx, { status: "running", progress: 5 });

		if (isYunwuKlingOmniModel(model)) {
			const aspectRatioForYunwu = inferYunwuAspectRatio({
				aspectRatio:
					typeof extras.aspectRatio === "string" ? extras.aspectRatio : null,
				size: typeof extras.size === "string" ? extras.size : null,
				orientation,
			});
			let klingDurationSeconds: number;
			try {
				klingDurationSeconds = normalizeYunwuKlingDurationSeconds({
					model,
					durationSeconds,
				});
			} catch (error) {
				throw new AppError(
					error instanceof Error ? error.message : "Yunwu Kling 视频时长无效",
					{
						status: 400,
						code: "yunwu_kling_duration_invalid",
						details: {
							model,
							durationSeconds,
						},
					},
				);
			}
			const modeRaw =
				typeof extras.mode === "string" ? extras.mode.trim().toLowerCase() : "";
			const mode = modeRaw === "pro" ? "pro" : "std";
			const soundRaw =
				typeof extras.sound === "string" ? extras.sound.trim().toLowerCase() : "";
			const sound = soundRaw === "on" ? "on" : "off";
			const referenceImages = (() => {
				const raw = Array.isArray(extras.referenceImages)
					? extras.referenceImages
					: [];
				return raw
					.map((item) => (typeof item === "string" ? item.trim() : ""))
					.filter(Boolean);
			})();
			const imageList = buildYunwuKlingImageList({
				kind: req.kind,
				firstFrameUrl:
					typeof extras.firstFrameUrl === "string"
						? extras.firstFrameUrl
						: referenceUrl,
				lastFrameUrl:
					typeof extras.lastFrameUrl === "string" ? extras.lastFrameUrl : null,
				referenceImages,
			});
			const body: Record<string, unknown> = {
				model_name: model,
				prompt: req.prompt,
				mode,
				aspect_ratio: aspectRatioForYunwu,
				duration: String(klingDurationSeconds),
				multi_shot: false,
				sound,
				...(imageList.length ? { image_list: imageList } : {}),
				...(typeof extras.watermark === "boolean"
					? { watermark_info: { enabled: extras.watermark } }
					: {}),
				...(typeof extras.callbackUrl === "string" && extras.callbackUrl.trim()
					? { callback_url: extras.callbackUrl.trim() }
					: {}),
				...(typeof extras.externalTaskId === "string" &&
				extras.externalTaskId.trim()
					? { external_task_id: extras.externalTaskId.trim() }
					: {}),
			};

			const requestLog = body;
			let data: unknown = null;
			const res = await fetchWithHttpDebugLog(
				c,
				`${normalizeYunwuBaseUrl(baseUrl)}/kling/v1/videos/omni-video`,
				{
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(body),
				},
				{ tag: "yunwu:kling:omni-video:create" },
			);
			try {
				data = await res.json();
			} catch {
				data = null;
			}
			if (res.status < 200 || res.status >= 300) {
				throw new AppError(
					extractUpstreamErrorMessage(data) ||
						`yunwu /kling/v1/videos/omni-video 调用失败: ${res.status}`,
					{
						status: res.status,
						code: "yunwu_kling_omni_video_create_failed",
						details: {
							upstreamStatus: res.status,
							upstreamData: data ?? null,
							requestBody: requestLog,
						},
					},
				);
			}

			const createdTaskId =
				(typeof (data as Record<string, unknown> | null)?.id === "string" &&
					String((data as Record<string, unknown>).id).trim()) ||
				(typeof (data as Record<string, unknown> | null)?.task_id === "string" &&
					String((data as Record<string, unknown>).task_id).trim()) ||
				(typeof (data as Record<string, unknown> | null)?.taskId === "string" &&
					String((data as Record<string, unknown>).taskId).trim()) ||
				null;
			if (!createdTaskId) {
				throw new AppError("yunwu kling omni-video 未返回任务 ID", {
					status: 502,
					code: "yunwu_task_id_missing",
					details: { upstreamData: data ?? null, requestBody: requestLog },
				});
			}

			const vendorForRef = `yunwu-${model}`;
			await upsertVendorTaskRefWithWarn(c, {
				userId,
				kind: "video",
				taskId: createdTaskId,
				vendor: vendorForRef,
				warnTag: "upsert yunwu kling video ref failed",
			});

			const status = normalizeYunwuVideoTaskStatus(
				extractYunwuKlingTaskStatus(data),
			);
			emitProgress(userId, progressCtx, {
				status,
				progress: status === "queued" ? 5 : 10,
				taskId: createdTaskId,
				raw: data ?? null,
			});

			const result = TaskResultSchema.parse({
				id: createdTaskId,
				kind: req.kind,
				status,
				assets: [],
				raw: {
					provider: "yunwu",
					model,
					taskId: createdTaskId,
					status,
					request: requestLog,
					response: data ?? null,
				},
			});
			await bindReservationToTaskId(c, userId, reservation, createdTaskId);
			const billedResult = attachBillingSpecKeyToTaskResult(result, billingSpecKey);
			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: vendorForRef,
				taskKind: req.kind,
				result: billedResult,
			});
			return billedResult;
		}

		const sizeForYunwu = (() => {
			const raw = typeof extras.size === "string" ? extras.size.trim() : "";
			if (/^\d+\s*x\s*\d+$/i.test(raw)) return raw.replace(/\s+/g, "");
			return orientation === "portrait" ? "720x1280" : "1280x720";
		})();

		const secondsForYunwu =
			typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
				? String(Math.max(1, Math.floor(durationSeconds)))
				: "10";

		const resolveYunwuReferenceFilePart = async (
			raw: string,
		): Promise<{ blob: Blob; filename: string; contentType: string }> => {
			const ref = String(raw || "").trim();
			if (!ref) {
				throw new AppError("Yunwu input_reference 为空", {
					status: 400,
					code: "yunwu_input_reference_empty",
				});
			}
			if (/^blob:/i.test(ref)) {
				throw new AppError("Yunwu input_reference 不支持 blob: URL，请先上传为可访问的图片地址", {
					status: 400,
					code: "yunwu_input_reference_invalid",
				});
			}

			const dataUrlMatch = ref.match(/^data:([^;]+);base64,(.+)$/i);
			if (dataUrlMatch) {
				const mimeType = (dataUrlMatch[1] || "").trim() || "application/octet-stream";
				if (
					mimeType !== "image/jpeg" &&
					mimeType !== "image/png" &&
					mimeType !== "image/webp"
				) {
					throw new AppError(
						`Yunwu input_reference 文件类型不受支持: ${mimeType}。仅支持 image/jpeg、image/png、image/webp`,
						{
							status: 400,
							code: "yunwu_input_reference_invalid_mime",
							details: { contentType: mimeType, source: ref.slice(0, 160) },
						},
					);
				}
				const base64 = (dataUrlMatch[2] || "").trim();
				const bytes = decodeBase64ToBytes(base64);
				const ext = detectImageExtensionFromMimeType(mimeType);
				return {
					blob: new Blob([new Uint8Array(bytes)], { type: mimeType }),
					filename: `input_reference.${ext || "bin"}`,
					contentType: mimeType,
				};
			}

			const resolvedRef = ref.startsWith("/")
				? new URL(ref, new URL(c.req.url).origin).toString()
				: ref;
			if (!/^https?:\/\//i.test(resolvedRef)) {
				throw new AppError("Yunwu input_reference 仅支持 http(s) URL 或 data:image/*;base64", {
					status: 400,
					code: "yunwu_input_reference_invalid",
					details: { source: ref.slice(0, 160) },
				});
			}

			let res: Response;
			try {
				res = await fetchWithHttpDebugLog(
					c,
					resolvedRef,
					{ method: "GET", headers: { Accept: "image/*,*/*;q=0.8" } },
					{ tag: "yunwu:input_reference:fetch" },
				);
			} catch (error: any) {
				throw new AppError("Yunwu input_reference 下载失败", {
					status: 502,
					code: "yunwu_input_reference_fetch_failed",
					details: { message: error?.message ?? String(error), source: resolvedRef.slice(0, 160) },
				});
			}
			if (!res.ok) {
				throw new AppError(`Yunwu input_reference 下载失败: ${res.status}`, {
					status: 502,
					code: "yunwu_input_reference_fetch_failed",
					details: { upstreamStatus: res.status, source: resolvedRef.slice(0, 160) },
				});
			}

			const contentType =
				(res.headers.get("content-type") || "").split(";")[0]?.trim() ||
				"application/octet-stream";
			if (
				contentType !== "image/jpeg" &&
				contentType !== "image/png" &&
				contentType !== "image/webp"
			) {
				throw new AppError(
					`Yunwu input_reference 文件类型不受支持: ${contentType}。仅支持 image/jpeg、image/png、image/webp`,
					{
						status: 400,
						code: "yunwu_input_reference_invalid_mime",
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
				filename: `input_reference.${ext || "bin"}`,
				contentType,
			};
		};

		const form = new FormData();
		form.append("model", model);
		form.append("prompt", req.prompt);
		form.append("seconds", secondsForYunwu);
		form.append("size", sizeForYunwu);

		if (referenceUrl) {
			const filePart = await resolveYunwuReferenceFilePart(referenceUrl);
			form.append("input_reference", filePart.blob, filePart.filename);
		}

		const requestLog: Record<string, unknown> = {
			model,
			prompt: req.prompt,
			seconds: secondsForYunwu,
			size: sizeForYunwu,
			...(referenceUrl ? { input_reference: referenceUrl } : {}),
		};

		let data: unknown = null;
		try {
			const res = await fetchWithHttpDebugLog(
				c,
				`${normalizeYunwuBaseUrl(baseUrl)}/v1/videos`,
				{
					method: "POST",
					headers: {
						Accept: "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: form,
				},
				{ tag: "yunwu:videos:create" },
			);
			try {
				data = await res.json();
			} catch {
				data = null;
			}
			if (res.status < 200 || res.status >= 300) {
				throw new AppError(
					extractUpstreamErrorMessage(data) || `yunwu /v1/videos 调用失败: ${res.status}`,
					{
						status: res.status,
						code: "yunwu_videos_create_failed",
						details: { upstreamStatus: res.status, upstreamData: data ?? null, requestBody: requestLog },
					},
				);
			}
		} catch (error) {
			throw error;
		}

		const createdTaskId =
			(typeof (data as Record<string, unknown> | null)?.id === "string" &&
				String((data as Record<string, unknown>).id).trim()) ||
			(typeof (data as Record<string, unknown> | null)?.task_id === "string" &&
				String((data as Record<string, unknown>).task_id).trim()) ||
			(typeof (data as Record<string, unknown> | null)?.taskId === "string" &&
				String((data as Record<string, unknown>).taskId).trim()) ||
			null;
		if (!createdTaskId) {
			throw new AppError("yunwu 未返回任务 ID", {
				status: 502,
				code: "yunwu_task_id_missing",
				details: { upstreamData: data ?? null, requestBody: requestLog },
			});
		}

		const vendorForRef = `yunwu-${model || "sora-2"}`;
		await upsertVendorTaskRefWithWarn(c, {
			userId,
			kind: "video",
			taskId: createdTaskId,
			vendor: vendorForRef,
			warnTag: "upsert yunwu video ref failed",
		});

		const status = normalizeYunwuVideoTaskStatus(data?.status);
		emitProgress(userId, progressCtx, {
			status,
			progress: status === "queued" ? 5 : 10,
			taskId: createdTaskId,
			raw: data ?? null,
		});

		const vendorForLog = `yunwu-${model || "sora-2"}`;
		const result = TaskResultSchema.parse({
			id: createdTaskId,
			kind: "text_to_video",
			status,
			assets: [],
			raw: {
				provider: "yunwu",
				model,
				taskId: createdTaskId,
				status,
				request: requestLog,
				response: data ?? null,
			},
		});
		await bindReservationToTaskId(c, userId, reservation, createdTaskId);
		const billedResult = attachBillingSpecKeyToTaskResult(result, billingSpecKey);
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind: "text_to_video",
			result: billedResult,
		});
		return billedResult;
	}

	if (isApimartBase) {
		emitProgress(userId, progressCtx, { status: "running", progress: 5 });

		const modelForApimart = (() => {
			const raw = (modelKeyRaw || "").trim().toLowerCase();
			if (raw === "sora-2-pro") return "sora-2-pro";
			return "sora-2";
		})();

		const imageUrls = (() => {
			const urls: string[] = [];
			const pushAll = (value: any) => {
				const arr = Array.isArray(value) ? value : [value];
				for (const item of arr) {
					if (typeof item === "string" && item.trim()) urls.push(item.trim());
				}
			};
			pushAll((extras as any).image_urls);
			pushAll((extras as any).imageUrls);
			pushAll((extras as any).urls);
			if (referenceUrl) urls.push(referenceUrl);
			return Array.from(new Set(urls)).slice(0, 14);
		})();

		const body: Record<string, any> = {
			model: modelForApimart,
			prompt: req.prompt,
			duration: durationSeconds,
			aspect_ratio: aspectRatio,
			...(typeof extras.private === "boolean" ? { private: extras.private } : {}),
			...(typeof extras.watermark === "boolean"
				? { watermark: extras.watermark }
				: {}),
			...(typeof extras.thumbnail === "boolean"
				? { thumbnail: extras.thumbnail }
				: {}),
			...(imageUrls.length ? { image_urls: imageUrls } : {}),
		};

		const data = await callJsonApi(
			c,
			`${normalizeApimartBaseUrl(baseUrl)}/v1/videos/generations`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			},
			{ provider: "apimart" },
		);

		if (typeof data?.code === "number" && data.code !== 200) {
			throw new AppError(
				(data?.error?.message ||
					data?.message ||
					`apimart 视频生成失败: code ${data.code}`) as string,
				{
					status: 502,
					code: "apimart_request_failed",
					details: { upstreamData: data ?? null, requestBody: body },
				},
			);
		}

		const first = Array.isArray(data?.data) ? data.data[0] : null;
		const createdTaskId =
			(typeof first?.task_id === "string" && first.task_id.trim()) ||
			(typeof first?.taskId === "string" && first.taskId.trim()) ||
			null;
		if (!createdTaskId) {
			throw new AppError("apimart 未返回 task_id", {
				status: 502,
				code: "apimart_task_id_missing",
				details: { upstreamData: data ?? null, requestBody: body },
			});
		}

		const vendorForRef = `apimart-${modelForApimart}`;
		await upsertVendorTaskRefWithWarn(c, {
			userId,
			kind: "video",
			taskId: createdTaskId,
			vendor: vendorForRef,
			warnTag: "upsert apimart video ref failed",
		});

		const vendorForLog = `apimart-${modelForApimart}`;
		const result = TaskResultSchema.parse({
			id: createdTaskId,
			kind: "text_to_video",
			status: "queued",
			assets: [],
			raw: {
				provider: "apimart",
				model: modelForApimart,
				taskId: createdTaskId,
				status: "queued",
				request: body,
				response: data ?? null,
			},
		});
		await bindReservationToTaskId(c, userId, reservation, createdTaskId);
		const billedResult = attachBillingSpecKeyToTaskResult(result, billingSpecKey);
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind: "text_to_video",
			result: billedResult,
		});
		return billedResult;
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
			const fetched = await fetchJsonWithDebug(c, {
				url: endpoint,
				init: {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(body),
				},
				tag: "sora2api:createVideo",
				requestFailedMessage: "sora2api 调用失败",
				requestFailedCode: "sora2api_request_failed",
			});
			res = fetched.response;
			data = fetched.data;
			attemptedEndpoints.push({ url: endpoint, status: res.status });
		} catch (error: any) {
			lastError = {
				status:
					typeof (error as any)?.status === "number" ? (error as any).status : 502,
				data: (error as any)?.details?.upstreamData ?? null,
				message: (error as any)?.message ?? String(error),
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

		{
			const normalizedModelForVendor = model.trim().startsWith("models/")
				? model.trim().slice(7)
				: model.trim();
			const vendorForRef = isGrsaiBase
				? `grsai-${normalizedModelForVendor || "sora-2"}`
				: "sora2api";
			await upsertVendorTaskRefWithWarn(c, {
				userId,
				kind: "video",
				taskId: createdTaskId,
				vendor: vendorForRef,
				warnTag: "upsert video ref failed",
			});
		}

	const normalizedModelForVendor = model.trim().startsWith("models/")
		? model.trim().slice(7)
		: model.trim();
	const vendorForLog = isGrsaiBase
		? `grsai-${normalizedModelForVendor || "sora-2"}`
		: "sora2api";
	const result = TaskResultSchema.parse({
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
	await bindReservationToTaskId(c, userId, reservation, createdTaskId);
	const billedResult = attachBillingSpecKeyToTaskResult(result, billingSpecKey);
	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: vendorForLog,
		taskKind: "text_to_video",
		result: billedResult,
	});
	return billedResult;
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

export async function fetchMappedTaskResultForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
	input: {
		taskId: string;
		taskKind?: TaskRequestDto["kind"] | null;
		kindHint?: "video" | "image" | null;
		promptFromClient?: string | null;
	},
): Promise<TaskResult | null> {
	const taskId = (input.taskId || "").trim();
	if (!taskId) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "task_id_required",
		});
	}

	const v = normalizeVendorKey(vendor);
	if (!v) return null;

	const taskKind = (input.taskKind ?? null) as TaskRequestDto["kind"] | null;

	const candidates = (() => {
		if (taskKind === "text_to_video") return ["text_to_video", "image_to_video"] as const;
		if (taskKind === "image_to_video") return ["image_to_video", "text_to_video"] as const;
		if (taskKind === "text_to_image") return ["text_to_image", "image_edit"] as const;
		if (taskKind === "image_edit") return ["image_edit", "text_to_image"] as const;
		if (input.kindHint === "video") return ["text_to_video", "image_to_video"] as const;
		if (input.kindHint === "image") return ["text_to_image", "image_edit"] as const;
		return [] as const;
	})();

	if (!candidates.length) return null;

	const storedRow = await getTaskResultByTaskId(c.env.DB, userId, taskId).catch(() => null);
	const storedPayload =
		typeof storedRow?.result === "string" ? safeParseJsonForTask(storedRow.result) : null;
	const storedRaw =
		storedPayload &&
		typeof storedPayload === "object" &&
		!Array.isArray(storedPayload) &&
		"raw" in storedPayload &&
		storedPayload.raw &&
		typeof storedPayload.raw === "object" &&
		!Array.isArray(storedPayload.raw)
			? (storedPayload.raw as Record<string, unknown>)
			: null;
	const preferredMappingId =
		typeof storedRaw?.mappingId === "string" && storedRaw.mappingId.trim()
			? storedRaw.mappingId.trim()
			: null;
	const preferredModelKey =
		typeof storedRaw?.model === "string" && storedRaw.model.trim()
			? storedRaw.model.trim()
			: null;

	let mapping: Awaited<ReturnType<typeof resolveEnabledModelCatalogMappingForTask>> =
		null;
	let mappingTaskKind: TaskRequestDto["kind"] | null = null;
	for (const k of candidates) {
		const resolved = await resolveEnabledModelCatalogMappingForTask(c, v, k, {
			preferredMappingId,
			stage: "result",
			req: {
				kind: k,
				prompt: typeof input.promptFromClient === "string" ? input.promptFromClient : "",
				extras: preferredModelKey ? { modelKey: preferredModelKey } : {},
			},
			taskId,
			modelKey: preferredModelKey,
		});
		if (resolved) {
			mapping = resolved;
			mappingTaskKind = k;
			break;
		}
	}
	if (!mapping || !mappingTaskKind) return null;

	const ctx = await resolveVendorContext(c, userId, v);
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}
	const apiKey = (ctx.apiKey || "").trim();
	if (!apiKey) {
		throw new AppError(`No API key configured for vendor ${v}`, {
			status: 400,
			code: "api_key_missing",
		});
	}
	const auth = await resolveModelCatalogVendorAuthForTask(c, v);

	const refKind =
		taskKind === "text_to_video" || taskKind === "image_to_video"
			? ("video" as const)
			: taskKind === "text_to_image" || taskKind === "image_edit"
				? ("image" as const)
				: input.kindHint === "video"
					? ("video" as const)
					: input.kindHint === "image"
						? ("image" as const)
						: null;
	const upstreamTaskId = await (async () => {
		if (!refKind) return taskId;
		try {
			const ref = await getVendorTaskRefByTaskId(
				c.env.DB,
				userId,
				refKind,
				taskId,
			);
			const pid =
				typeof (ref as any)?.pid === "string" && (ref as any).pid.trim()
					? String((ref as any).pid).trim()
					: null;
			return pid || taskId;
		} catch {
			return taskId;
		}
	})();

	const reqKindForResult: TaskRequestDto["kind"] = taskKind || mappingTaskKind;
	const requestForMapping: TaskRequestDto = {
		kind: reqKindForResult,
		prompt: typeof input.promptFromClient === "string" ? input.promptFromClient : "",
		extras: {},
	};

	const upstream = await buildMappedUpstreamRequest({
		c,
		baseUrl,
		apiKey,
		auth,
		stage: "result",
		requestMapping: mapping.requestMapping,
		req: requestForMapping,
		taskId: upstreamTaskId,
	});
	await recordVendorCallPayloads(c, {
		userId,
		vendor: v,
		taskId,
		taskKind: reqKindForResult,
		request: upstream.requestLog,
	});

	const payload = await callJsonApi(c, upstream.url, upstream.init, {
		provider: v,
		requestPayload: upstream.requestLog,
	});
	await recordVendorCallPayloads(c, {
		userId,
		vendor: v,
		taskId,
		taskKind: reqKindForResult,
		request: upstream.requestLog,
		upstreamResponse: { url: upstream.url, data: payload },
	});

	let parsed = parseMappedTaskResultFromPayload({
		vendorKey: v,
		model: null,
		stage: "result",
		reqKind: reqKindForResult,
		payload,
		responseMapping: mapping.responseMapping,
		fallbackTaskId: upstreamTaskId,
		selectedStageMapping: upstream.selectedStageMapping,
	});

	if (v === "yunwu" && (reqKindForResult === "text_to_video" || reqKindForResult === "image_to_video")) {
		const yunwuRawStatus = extractYunwuKlingTaskStatus(payload);
		const yunwuVideoUrl = extractYunwuKlingVideoUrl(payload);
		let yunwuStatus = normalizeYunwuVideoTaskStatus(yunwuRawStatus);
		if (yunwuStatus === "succeeded" && !yunwuVideoUrl) {
			yunwuStatus = "running";
		}
		if (yunwuStatus !== "succeeded" && yunwuVideoUrl) {
			yunwuStatus = "succeeded";
		}
		if (
			yunwuStatus !== parsed.status ||
			(yunwuVideoUrl &&
				!parsed.assets.some(
					(asset) => asset.type === "video" && asset.url.trim() === yunwuVideoUrl,
				))
		) {
			parsed = TaskResultSchema.parse({
				...parsed,
				status: yunwuStatus,
				assets: yunwuVideoUrl
					? [
							TaskAssetSchema.parse({
								type: "video",
								url: yunwuVideoUrl,
								thumbnailUrl: null,
							}),
					  ]
					: parsed.assets,
				raw: {
					...(parsed.raw as any),
					yunwuNormalized: {
						status:
							typeof yunwuRawStatus === "string" && yunwuRawStatus.trim()
								? yunwuRawStatus.trim()
								: null,
						videoUrl: yunwuVideoUrl,
					},
				},
			});
		}
	}

	if (upstreamTaskId !== taskId) {
		const upstreamId = typeof parsed.id === "string" ? parsed.id.trim() : "";
		parsed = TaskResultSchema.parse({
			...parsed,
			id: taskId,
			raw: {
				...(parsed.raw as any),
				upstreamTaskId: upstreamId || upstreamTaskId,
				vendorTaskId: upstreamId || upstreamTaskId,
				taskStoreId: taskId,
			},
		});
	}

	if (parsed.status === "succeeded" && parsed.assets && parsed.assets.length > 0) {
		const stagedAssets = await stageTaskAssetsForAsyncHosting({
			c,
			userId,
				assets: parsed.assets,
				meta: {
					taskKind: parsed.kind as TaskRequestDto["kind"],
				prompt:
					typeof input.promptFromClient === "string" && input.promptFromClient.trim()
						? input.promptFromClient.trim()
						: null,
				vendor: v,
				modelKey:
					typeof payload?.model === "string" && payload.model.trim()
						? payload.model.trim()
						: undefined,
				taskId: taskId ?? null,
			},
		});

		parsed = TaskResultSchema.parse({
			...parsed,
			assets: stagedAssets,
			raw: {
				...(parsed.raw as any),
				hosting: { status: "pending", mode: "async" },
			},
		});
	}

	await recordVendorCallForTaskResult(c, {
		userId,
		vendor,
		taskKind: reqKindForResult,
		result: parsed,
	});

	return parsed;
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
	const refForTask = await (async () => {
		try {
			return await getVendorTaskRefByTaskId(c.env.DB, userId, "video", taskId);
		} catch {
			return null;
		}
	})();
	const refVendorRaw =
		typeof refForTask?.vendor === "string" ? refForTask.vendor.trim() : "";
	{
		const hint = extractChannelVendor(refVendorRaw);
		if (hint) {
			try {
				c.set("proxyVendorHint", hint);
			} catch {
				// ignore
			}
		}
	}
	const vendorForTask: "sora2api" | "grsai" = refVendorRaw
		.toLowerCase()
		.startsWith("grsai")
		? "grsai"
		: "sora2api";
	const vendorForLog = refVendorRaw || vendorForTask;
	const shouldBypassMappedResult = refVendorRaw.toLowerCase().startsWith("yunwu");
	if (!shouldBypassMappedResult) {
		const mapped = await fetchMappedTaskResultForVendor(c, userId, vendorForTask, {
			taskId,
			taskKind: "text_to_video",
			kindHint: "video",
			promptFromClient: promptFromClient ?? null,
		});
		if (mapped) return mapped;
	}

	const ctx = await resolveVendorContext(c, userId, vendorForTask);
	if (ctx.viaProxyVendor === "comfly") {
		const result = await fetchComflySora2VideoTaskResult(
			c,
			userId,
			taskId,
			ctx,
			"text_to_video",
		);
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind: "text_to_video",
			result,
		});
		return result;
	}
	const baseUrl =
		normalizeBaseUrl(ctx.baseUrl) ||
		(vendorForTask === "grsai" ? "https://api.grsai.com" : "http://localhost:8000");
	const isGrsaiBase =
		isGrsaiBaseUrl(baseUrl) || ctx.viaProxyVendor === "grsai";
	const isApimartBase =
		isApimartBaseUrl(baseUrl) || ctx.viaProxyVendor === "apimart";
	const isYunwuBase =
		isYunwuBaseUrl(baseUrl) || ctx.viaProxyVendor === "yunwu";
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError(
			resolveImageVendorApiKeyMissingMessage({ isApimartBase, isYunwuBase }),
			{
				status: 400,
				code: "sora2api_api_key_missing",
			},
		);
	}

	if (isYunwuBase) {
		const upstreamTaskId =
			typeof refForTask?.pid === "string" && refForTask.pid.trim()
				? refForTask.pid.trim()
				: taskId.trim();
		const yunwuBaseUrl = normalizeYunwuBaseUrl(baseUrl);
		const yunwuModel = extractYunwuModelFromVendorRef(refVendorRaw);
		const isKlingOmniVideo = isYunwuKlingOmniModel(yunwuModel || "");
		const candidates = isKlingOmniVideo
			? [
					new URL(
						`/kling/v1/videos/omni-video/${encodeURIComponent(upstreamTaskId)}`,
						yunwuBaseUrl,
					).toString(),
			  ]
			: [
					new URL(
						`/v1/videos/${encodeURIComponent(upstreamTaskId)}`,
						yunwuBaseUrl,
					).toString(),
					new URL(
						`/v1/videos?id=${encodeURIComponent(upstreamTaskId)}`,
						yunwuBaseUrl,
					).toString(),
					new URL(
						`/v1/videos?task_id=${encodeURIComponent(upstreamTaskId)}`,
						yunwuBaseUrl,
					).toString(),
					new URL(
						`/v1/video/query?id=${encodeURIComponent(upstreamTaskId)}`,
						yunwuBaseUrl,
					).toString(),
			  ];
		let payload: any = null;
		let lastError: { status?: number; data?: any; message?: string; url?: string } | null =
			null;

		for (const url of candidates) {
			let res: Response;
			let data: any = null;
			try {
				res = await fetchWithHttpDebugLog(
					c,
					url,
					{
						method: "GET",
						headers: {
							Accept: "application/json",
							Authorization: `Bearer ${apiKey}`,
						},
					},
					{
						tag: isKlingOmniVideo
							? "yunwu:kling:omni-video:result"
							: "yunwu:videos:result",
					},
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
					url,
				};
				continue;
			}
			if (res.status < 200 || res.status >= 300) {
				lastError = {
					status: res.status,
					data,
					message:
						extractUpstreamErrorMessage(data) || `yunwu 视频结果查询失败: ${res.status}`,
					url,
				};
				continue;
			}
			payload = data ?? null;
			break;
		}
		if (!payload) {
			throw new AppError(lastError?.message || "yunwu 视频结果查询失败", {
				status: lastError?.status ?? 502,
				code: "yunwu_videos_result_failed",
				details: {
					upstreamStatus: lastError?.status ?? null,
					upstreamData: lastError?.data ?? null,
					endpointTried: lastError?.url ?? null,
				},
			});
		}

		let status = normalizeYunwuVideoTaskStatus(
			isKlingOmniVideo ? extractYunwuKlingTaskStatus(payload) : payload?.status,
		);
		const videoUrlRaw = isKlingOmniVideo
			? extractYunwuKlingVideoUrl(payload)
			: (typeof payload?.video_url === "string" && payload.video_url.trim()) ||
				(typeof payload?.videoUrl === "string" && payload.videoUrl.trim()) ||
				null;
		const videoUrl = videoUrlRaw ? videoUrlRaw.trim() : null;
		if (status === "succeeded" && !videoUrl) {
			status = "running";
		}

		if (status === "succeeded" && videoUrl) {
			const asset = TaskAssetSchema.parse({
				type: "video",
				url: videoUrl,
				thumbnailUrl: null,
			});

			const promptForAsset = (() => {
				const client =
					typeof promptFromClient === "string" && promptFromClient.trim()
						? promptFromClient.trim()
						: null;
				const enhanced =
					typeof payload?.enhanced_prompt === "string" &&
					payload.enhanced_prompt.trim()
						? payload.enhanced_prompt.trim()
						: null;
				return enhanced || client;
			})();

			const stagedAssets = await stageTaskAssetsForAsyncHosting({
				c,
				userId,
				assets: [asset],
				meta: {
					taskKind: "text_to_video",
					prompt: promptForAsset,
					vendor: vendorForLog,
					modelKey:
						typeof payload?.model === "string"
							? payload.model
							: typeof payload?.model_name === "string"
								? payload.model_name
								: yunwuModel || undefined,
					taskId: taskId ?? null,
				},
			});

			const result = TaskResultSchema.parse({
				id: taskId,
				kind: "text_to_video",
				status: "succeeded",
				assets: stagedAssets,
				raw: {
					provider: "yunwu",
					response: payload ?? null,
					hosting: { status: "pending", mode: "async" },
				},
			});
			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: vendorForLog,
				taskKind: "text_to_video",
				result,
			});
			return result;
		}

		const result = TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status,
			assets: [],
			raw: {
				provider: "yunwu",
				response: payload ?? null,
			},
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind: "text_to_video",
			result,
		});
		return result;
	}

	if (isApimartBase) {
		const wrapper = await callJsonApi(
			c,
			`${normalizeApimartBaseUrl(baseUrl)}/v1/tasks/${encodeURIComponent(taskId.trim())}?language=zh`,
			{
				method: "GET",
				headers: { Authorization: `Bearer ${apiKey}` },
			},
			{ provider: "apimart" },
		);

		if (typeof wrapper?.code === "number" && wrapper.code !== 200) {
			throw new AppError(
				(wrapper?.error?.message ||
					wrapper?.message ||
					`apimart 任务查询失败: code ${wrapper.code}`) as string,
				{
					status: 502,
					code: "apimart_result_failed",
					details: { upstreamData: wrapper ?? null },
				},
			);
		}

		const payload =
			wrapper && typeof wrapper === "object" && wrapper.data
				? wrapper.data
				: wrapper ?? {};
		let status = normalizeApimartTaskStatus(payload?.status);
		const progress = clampProgress(
			typeof payload?.progress === "number" ? payload.progress : undefined,
		);

		const urls = extractApimartMediaUrls(payload, "videos");
		const thumbnailUrl = extractApimartThumbnailUrl(payload);
		if (status === "succeeded" && urls.length === 0) {
			status = "running";
		}

		if (status === "succeeded" && urls.length > 0) {
			const asset = TaskAssetSchema.parse({
				type: "video",
				url: urls[0]!,
				thumbnailUrl: thumbnailUrl,
			});

			const stagedAssets = await stageTaskAssetsForAsyncHosting({
				c,
				userId,
				assets: [asset],
				meta: {
					taskKind: "text_to_video",
					prompt:
						typeof promptFromClient === "string" && promptFromClient.trim()
							? promptFromClient.trim()
							: null,
					vendor: vendorForLog,
					taskId: taskId ?? null,
				},
			});

			const result = TaskResultSchema.parse({
				id: taskId,
				kind: "text_to_video",
				status: "succeeded",
				assets: stagedAssets,
				raw: {
					provider: "apimart",
					response: payload,
					hosting: { status: "pending", mode: "async" },
				},
			});
			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: vendorForLog,
				taskKind: "text_to_video",
				result,
			});
			return result;
		}

		const failureReasonRaw =
			(typeof payload?.error?.message === "string" &&
				payload.error.message.trim()) ||
			(typeof wrapper?.error?.message === "string" &&
				wrapper.error.message.trim()) ||
			null;

		const result = TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status,
			assets: [],
			raw: {
				provider: "apimart",
				response: payload,
				progress,
				failureReason: failureReasonRaw,
				wrapper: wrapper ?? null,
			},
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind: "text_to_video",
			result,
		});
		return result;
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

		const pidForRef = (() => {
			const candidate =
				typeof (mergedPayload as any)?.pid === "string"
					? String((mergedPayload as any).pid).trim()
					: typeof (mergedPayload as any)?.postId === "string"
						? String((mergedPayload as any).postId).trim()
						: typeof (mergedPayload as any)?.post_id === "string"
							? String((mergedPayload as any).post_id).trim()
							: "";
			return candidate ? candidate : null;
		})();
		if (pidForRef) {
			await upsertVendorTaskRefWithWarn(c, {
				userId,
				kind: "video",
				taskId,
				vendor: vendorForLog,
				pid: pidForRef,
				warnTag: "upsert video pid failed",
			});
		}
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

			const stagedAssets = await stageTaskAssetsForAsyncHosting({
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

			const result = TaskResultSchema.parse({
				id: taskId,
				kind: "text_to_video",
				status: "succeeded",
				assets: stagedAssets,
				raw: {
					provider: "sora2api",
					response: mergedPayload,
					hosting: { status: "pending", mode: "async" },
				},
			});
			await recordVendorCallForTaskResult(c, {
				userId,
				vendor: vendorForLog,
				taskKind: "text_to_video",
				result,
			});
			return result;
		}

		const result = TaskResultSchema.parse({
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
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind: "text_to_video",
			result,
		});
		return result;
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

function normalizeAsyncDataTaskStatus(value: unknown): TaskStatus {
	if (typeof value !== "string") return "running";
	const normalized = value.trim().toLowerCase();
	if (!normalized) return "running";
	if (
		normalized === "completed" ||
		normalized === "complete" ||
		normalized === "succeeded" ||
		normalized === "success" ||
		normalized === "done"
	) {
		return "succeeded";
	}
	if (
		normalized === "failed" ||
		normalized === "failure" ||
		normalized === "error" ||
		normalized === "cancelled" ||
		normalized === "canceled"
	) {
		return "failed";
	}
	if (normalized === "queued" || normalized === "pending" || normalized === "submitted") {
		return "queued";
	}
	if (
		normalized === "running" ||
		normalized === "processing" ||
		normalized === "generating" ||
		normalized === "in_progress" ||
		normalized === "in-progress"
	) {
		return "running";
	}
	return "running";
}

function looksLikeAsyncDataVideoUrl(url: string): boolean {
	const trimmed = (url || "").trim();
	if (!trimmed) return false;
	if (looksLikeVideoUrl(trimmed)) return true;
	const lower = trimmed.toLowerCase();
	// OpenAI signed URLs may not have an explicit video extension.
	if (lower.includes("videos.openai.com/")) return true;
	return false;
}

export async function fetchAsyncDataTaskResult(
	c: AppContext,
	userId: string,
	taskId: string,
	options?: { taskKind?: TaskRequestDto["kind"] | null; promptFromClient?: string | null },
): Promise<TaskResult> {
	if (!taskId || !taskId.trim()) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "task_id_required",
		});
	}

	const taskKind: TaskRequestDto["kind"] =
		typeof options?.taskKind === "string" && options.taskKind.trim()
			? (options.taskKind as TaskRequestDto["kind"])
			: "text_to_video";

	const refForTask = await (async () => {
		try {
			return await getVendorTaskRefByTaskId(c.env.DB, userId, "video", taskId);
		} catch {
			return null;
		}
	})();

	// Enforce per-user task ownership (asyncdata is a public endpoint).
	if (!refForTask) {
		throw new AppError("taskId is not found", {
			status: 404,
			code: "task_not_found",
		});
	}

	const vendorRefRaw =
		typeof refForTask?.vendor === "string" ? refForTask.vendor.trim() : "";
	const vendorForLog = (() => {
		if (!vendorRefRaw) return "asyncdata";
		const head = vendorRefRaw.split(":")[0]?.trim() || "";
		return head || vendorRefRaw;
	})();

	const pid = typeof refForTask?.pid === "string" ? refForTask.pid.trim() : "";
	if (refForTask && !pid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId.trim())) {
		const result = TaskResultSchema.parse({
			id: taskId.trim(),
			kind: taskKind,
			status: "running",
			assets: [],
			raw: {
				provider: "asyncdata",
				vendor: vendorForLog,
				upstreamTaskId: null,
				waitingUpstreamTaskId: true,
			},
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind,
			result,
		});
		return result;
	}

	const upstreamTaskId = pid || taskId.trim();
	const canonicalTaskId = upstreamTaskId;

	const payload = await callJsonApi(
		c,
		`https://pro.asyncdata.net/source/${encodeURIComponent(upstreamTaskId)}`,
		{
			method: "GET",
			headers: { Accept: "application/json" },
		},
		{ provider: "asyncdata" },
	);

	let status = normalizeAsyncDataTaskStatus(payload?.status);
	const progress =
		typeof payload?.progress === "number" && Number.isFinite(payload.progress)
			? Math.max(0, Math.min(100, Math.round(payload.progress)))
			: undefined;

	const pickVideoUrl = (): string | null => {
		const candidates = [
			payload?.url,
			payload?.draft_info?.downloadable_url,
			payload?.draft_info?.download_urls?.no_watermark,
			payload?.draft_info?.download_urls?.watermark,
			payload?.draft_info?.url,
		];
		for (const v of candidates) {
			if (typeof v === "string" && v.trim() && looksLikeAsyncDataVideoUrl(v)) {
				return v.trim();
			}
		}
		for (const v of candidates) {
			if (typeof v === "string" && v.trim()) return v.trim();
		}
		return null;
	};

	const videoUrl = pickVideoUrl();
	const thumbRaw =
		(typeof payload?.thumbnail_url === "string" && payload.thumbnail_url.trim()) ||
		(typeof payload?.thumbnailUrl === "string" && payload.thumbnailUrl.trim()) ||
		(typeof payload?.gif_url === "string" && payload.gif_url.trim()) ||
		(typeof payload?.gifUrl === "string" && payload.gifUrl.trim()) ||
		null;

	if (status === "succeeded" && !videoUrl) {
		status = "running";
	}
	if (status !== "succeeded" && videoUrl) {
		// Some upstreams only populate URLs late; treat presence of a downloadable URL as success.
		status = "succeeded";
	}

	if (status === "succeeded" && videoUrl) {
		const asset = TaskAssetSchema.parse({
			type: "video",
			url: videoUrl,
			thumbnailUrl: thumbRaw ? thumbRaw.trim() : null,
		});

		const promptForAsset =
			typeof options?.promptFromClient === "string" && options.promptFromClient.trim()
				? options.promptFromClient.trim()
				: null;

		const stagedAssets = await stageTaskAssetsForAsyncHosting({
			c,
			userId,
			assets: [asset],
			meta: {
				taskKind,
				prompt: promptForAsset,
				vendor: vendorForLog,
				taskId: canonicalTaskId,
			},
		});

		const result = TaskResultSchema.parse({
			id: canonicalTaskId,
			kind: taskKind,
			status: "succeeded",
			assets: stagedAssets,
			raw: {
				provider: "asyncdata",
				vendor: vendorForLog,
				upstreamTaskId,
				requestedTaskId: taskId.trim() !== canonicalTaskId ? taskId.trim() : null,
				response: payload ?? null,
				hosting: { status: "pending", mode: "async" },
			},
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind,
			result,
		});
		return result;
	}

	const result = TaskResultSchema.parse({
		id: canonicalTaskId,
		kind: taskKind,
		status,
		assets: [],
		raw: {
			provider: "asyncdata",
			vendor: vendorForLog,
			upstreamTaskId,
			requestedTaskId: taskId.trim() !== canonicalTaskId ? taskId.trim() : null,
			response: payload ?? null,
			progress,
		},
	});
	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: vendorForLog,
		taskKind,
		result,
	});
	return result;
}

export async function fetchTuziTaskResult(
	c: AppContext,
	userId: string,
	taskId: string,
	options?: { taskKind?: TaskRequestDto["kind"] | null; promptFromClient?: string | null },
): Promise<TaskResult> {
	if (!taskId || !taskId.trim()) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "task_id_required",
		});
	}

	const taskKind: TaskRequestDto["kind"] =
		typeof options?.taskKind === "string" && options.taskKind.trim()
			? (options.taskKind as TaskRequestDto["kind"])
			: "text_to_video";

	const refForTask = await (async () => {
		try {
			return await getVendorTaskRefByTaskId(c.env.DB, userId, "video", taskId);
		} catch {
			return null;
		}
	})();

	// Enforce per-user task ownership.
	if (!refForTask) {
		throw new AppError("taskId is not found", {
			status: 404,
			code: "task_not_found",
		});
	}

	const vendorRefRaw =
		typeof refForTask?.vendor === "string" ? refForTask.vendor.trim() : "";
	const vendorForLog = vendorRefRaw ? vendorRefRaw.split(":")[0]?.trim() || "tuzi" : "tuzi";
	const dispatchTail = vendorRefRaw
		? vendorRefRaw.split(":").slice(-1)[0]?.trim().toLowerCase() || ""
		: "";
	if (dispatchTail === "asyncdata") {
		return fetchAsyncDataTaskResult(c, userId, taskId, options);
	}
	{
		const mapped = await fetchMappedTaskResultForVendor(c, userId, "tuzi", {
			taskId,
			taskKind,
			kindHint: "video",
			promptFromClient: options?.promptFromClient ?? null,
		});
		if (mapped) return mapped;
	}

	const pid = typeof refForTask?.pid === "string" ? refForTask.pid.trim() : "";
	const upstreamTaskId = pid || taskId.trim();

	const ctx = await resolveVendorContext(c, userId, "tuzi");
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = ctx.apiKey.trim();
	if (!baseUrl || !apiKey) {
		throw new AppError("未配置 Tuzi API Key", {
			status: 400,
			code: "tuzi_api_key_missing",
		});
	}

	const candidates = [
		new URL(`/v1/videos/${encodeURIComponent(upstreamTaskId)}`, baseUrl).toString(),
		new URL(`/v1/videos?task_id=${encodeURIComponent(upstreamTaskId)}`, baseUrl).toString(),
		new URL(`/v1/videos?id=${encodeURIComponent(upstreamTaskId)}`, baseUrl).toString(),
	];

	let payload: any = null;
	let lastError: { status?: number; data?: any; message?: string; url?: string } | null =
		null;

	for (const url of candidates) {
		let res: Response;
		let data: any = null;
		try {
			res = await fetchWithHttpDebugLog(
				c,
				url,
				{
					method: "GET",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						Accept: "application/json",
					},
				},
				{ tag: "tuzi:videos:result" },
			);
			try {
				data = await res.json();
			} catch {
				data = null;
			}
		} catch (err: any) {
			lastError = { message: err?.message ?? String(err), url };
			continue;
		}

		if (!res.ok) {
			lastError = { status: res.status, data, url };
			continue;
		}

		payload = data;
		break;
	}

	if (!payload) {
		const msg =
			(lastError?.data &&
				(lastError.data.error?.message || lastError.data.message || lastError.data.error)) ||
			lastError?.message ||
			"Tuzi 结果查询失败";
		throw new AppError(msg, {
			status: lastError?.status ?? 502,
			code: "tuzi_result_failed",
			details: {
				upstreamStatus: lastError?.status ?? null,
				upstreamData: lastError?.data ?? null,
				endpointTried: lastError?.url ?? null,
			},
		});
	}

	let status = normalizeTuziVideoTaskStatus(
		payload?.status ?? payload?.data?.status ?? payload?.result?.status,
	);
	const progress =
		typeof payload?.progress === "number" && Number.isFinite(payload.progress)
			? Math.max(0, Math.min(100, Math.round(payload.progress)))
			: typeof payload?.data?.progress === "number" && Number.isFinite(payload.data.progress)
				? Math.max(0, Math.min(100, Math.round(payload.data.progress)))
				: undefined;

	const videoUrl =
		extractSora2OfficialVideoUrl(payload) ||
		extractSora2OfficialVideoUrl(payload?.data) ||
		null;
	const thumbRaw =
		(typeof payload?.thumbnail_url === "string" && payload.thumbnail_url.trim()) ||
		(typeof payload?.thumbnailUrl === "string" && payload.thumbnailUrl.trim()) ||
		(typeof payload?.gif_url === "string" && payload.gif_url.trim()) ||
		(typeof payload?.gifUrl === "string" && payload.gifUrl.trim()) ||
		(null as string | null);

	if (status === "succeeded" && !videoUrl) {
		status = "running";
	}
	if (status !== "succeeded" && videoUrl) {
		status = "succeeded";
	}

	if (status === "succeeded" && videoUrl) {
		const asset = TaskAssetSchema.parse({
			type: "video",
			url: videoUrl,
			thumbnailUrl: thumbRaw ? thumbRaw.trim() : null,
		});

		const promptForAsset =
			typeof options?.promptFromClient === "string" && options.promptFromClient.trim()
				? options.promptFromClient.trim()
				: null;

		const stagedAssets = await stageTaskAssetsForAsyncHosting({
			c,
			userId,
			assets: [asset],
			meta: {
				taskKind,
				prompt: promptForAsset,
				vendor: vendorForLog,
				modelKey:
					typeof payload?.model === "string"
						? payload.model
						: typeof payload?.data?.model === "string"
							? payload.data.model
							: undefined,
				taskId: upstreamTaskId || null,
			},
		});

		const result = TaskResultSchema.parse({
			id: upstreamTaskId,
			kind: taskKind,
			status: "succeeded",
			assets: stagedAssets,
			raw: {
				provider: "tuzi",
				vendor: vendorForLog,
				upstreamTaskId,
				response: payload ?? null,
				hosting: { status: "pending", mode: "async" },
			},
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind,
			result,
		});
		return result;
	}

	if (status === "failed") {
		const errorMessage = (() => {
			const candidates = [
				payload?.error?.message,
				payload?.error_message,
				payload?.message,
				payload?.error,
				payload?.data?.error?.message,
				payload?.data?.error_message,
				payload?.data?.message,
				payload?.data?.error,
			];
			for (const value of candidates) {
				if (typeof value === "string" && value.trim()) return value.trim();
			}
			return null;
		})();

		const result = TaskResultSchema.parse({
			id: upstreamTaskId,
			kind: taskKind,
			status: "failed",
			assets: [],
			raw: {
				provider: "tuzi",
				vendor: vendorForLog,
				upstreamTaskId,
				response: payload ?? null,
				progress,
				error: errorMessage,
				message: errorMessage,
			},
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind,
			result,
		});
		return result;
	}

	const result = TaskResultSchema.parse({
		id: upstreamTaskId,
		kind: taskKind,
		status,
		assets: [],
		raw: {
			provider: "tuzi",
			vendor: vendorForLog,
			upstreamTaskId,
			response: payload ?? null,
			progress,
		},
	});
	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: vendorForLog,
		taskKind,
		result,
	});
	return result;
}

function normalizeGrsaiDrawTaskStatus(value: unknown): TaskStatus {
	if (typeof value !== "string") return "running";
	const normalized = value.trim().toLowerCase();
	if (!normalized) return "running";
	if (
		normalized === "succeeded" ||
		normalized === "success" ||
		normalized === "completed"
	) {
		return "succeeded";
	}
	if (
		normalized === "failed" ||
		normalized === "failure" ||
		normalized === "error"
	) {
		return "failed";
	}
	if (normalized === "queued" || normalized === "submitted") {
		return "queued";
	}
	if (
		normalized === "processing" ||
		normalized === "in_progress" ||
		normalized === "running"
	) {
		return "running";
	}
	return "running";
}

function normalizeApimartTaskStatus(value: unknown): TaskStatus {
	if (typeof value !== "string") return "running";
	const normalized = value.trim().toLowerCase();
	if (!normalized) return "running";
	if (normalized === "submitted" || normalized === "pending") return "queued";
	if (normalized === "processing") return "running";
	if (normalized === "completed") return "succeeded";
	if (normalized === "failed" || normalized === "cancelled") return "failed";
	return "running";
}

function normalizeYunwuVideoTaskStatus(value: unknown): TaskStatus {
	if (typeof value !== "string") return "running";
	const normalized = value.trim().toLowerCase();
	if (!normalized) return "running";
	if (normalized === "pending" || normalized === "submitted" || normalized === "queued") {
		return "queued";
	}
	if (
		normalized === "processing" ||
		normalized === "running" ||
		normalized === "in_progress" ||
		normalized === "in-progress"
	) {
		return "running";
	}
	if (
		normalized === "succeed" ||
		normalized === "success" ||
		normalized === "succeeded" ||
		normalized === "completed" ||
		normalized === "done"
	) {
		return "succeeded";
	}
	if (
		normalized === "failed" ||
		normalized === "failure" ||
		normalized === "error" ||
		normalized === "cancelled" ||
		normalized === "canceled"
	) {
		return "failed";
	}
	return "running";
}

function extractApimartMediaUrls(
	payload: any,
	key: "images" | "videos",
): string[] {
	const cleanBase64 = (value: string): string => String(value || "").replace(/\s+/g, "");
	const inferImageMimeTypeFromBase64 = (value: string): string => {
		const cleaned = cleanBase64(value);
		if (cleaned.startsWith("/9j/")) return "image/jpeg";
		if (cleaned.startsWith("iVBORw0KGgo")) return "image/png";
		if (cleaned.startsWith("R0lGOD")) return "image/gif";
		if (cleaned.startsWith("UklGR")) return "image/webp";
		if (cleaned.startsWith("Qk0")) return "image/bmp";
		if (cleaned.startsWith("AAABAA")) return "image/x-icon";
		return "image/png";
	};
	const looksLikeImageBase64 = (value: string): boolean => {
		const cleaned = cleanBase64(value);
		if (cleaned.length < 256) return false;
		if (!/^[A-Za-z0-9+/_-]+=*$/.test(cleaned)) return false;
		return (
			cleaned.startsWith("/9j/") ||
			cleaned.startsWith("iVBORw0KGgo") ||
			cleaned.startsWith("R0lGOD") ||
			cleaned.startsWith("UklGR") ||
			cleaned.startsWith("Qk0") ||
			cleaned.startsWith("AAABAA")
		);
	};
	const normalizeUrlCandidate = (value: unknown): string | null => {
		if (typeof value !== "string") return null;
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (key === "images") {
			if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return trimmed;
			if (looksLikeImageBase64(trimmed)) {
				const cleaned = cleanBase64(trimmed);
				const mimeType = inferImageMimeTypeFromBase64(cleaned);
				return `data:${mimeType};base64,${cleaned}`;
			}
		}
		return trimmed;
	};

	const result = payload && typeof payload === "object" ? payload.result : null;
	const items = Array.isArray(result?.[key]) ? result[key] : [];
	const urls = new Set<string>();
	for (const item of items) {
		if (typeof item === "string") {
			const normalized = normalizeUrlCandidate(item);
			if (normalized) urls.add(normalized);
			continue;
		}
		if (!item || typeof item !== "object") continue;

		const candidates: unknown[] = [];
		const value = (item as any)?.url;
		if (Array.isArray(value)) {
			candidates.push(...value);
		} else {
			candidates.push(value);
		}
		candidates.push(
			(item as any)?.imageUrl,
			(item as any)?.image_url,
			(item as any)?.uri,
			(item as any)?.href,
		);
		if (key === "images") {
			candidates.push(
				(item as any)?.base64,
				(item as any)?.b64_json,
				(item as any)?.image_base64,
			);
		}

		for (const candidate of candidates) {
			const normalized = normalizeUrlCandidate(candidate);
			if (normalized) {
				urls.add(normalized);
			}
		}
	}
	return Array.from(urls);
}

function extractApimartThumbnailUrl(payload: any): string | null {
	if (!payload || typeof payload !== "object") return null;
	const result = (payload as any).result;
	const candidates = [
		result?.thumbnail_url,
		result?.thumbnailUrl,
		(payload as any).thumbnail_url,
		(payload as any).thumbnailUrl,
	];
	for (const value of candidates) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

export async function fetchGrsaiDrawTaskResult(
	c: AppContext,
	userId: string,
	taskId: string,
	options?: { taskKind?: TaskRequestDto["kind"] | null; promptFromClient?: string | null },
): Promise<TaskResult> {
	if (!taskId || !taskId.trim()) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "task_id_required",
		});
	}

	const refForLog = await (async () => {
		try {
			return await getVendorTaskRefByTaskId(
				c.env.DB,
				userId,
				"image",
				taskId,
			);
		} catch {
			return null;
		}
	})();

	let vendorForLog =
		(typeof refForLog?.vendor === "string" && refForLog.vendor.trim()) ||
		"grsai";
	{
		const hint = extractChannelVendor(vendorForLog);
		if (hint) {
			try {
				c.set("proxyVendorHint", hint);
			} catch {
				// ignore
			}
		}
	}
	const taskKind: TaskRequestDto["kind"] =
		typeof options?.taskKind === "string" && options.taskKind.trim()
			? (options.taskKind as TaskRequestDto["kind"])
			: "text_to_image";
	let pid =
		typeof refForLog?.pid === "string" ? refForLog.pid.trim() : "";

	// Backward-compatible recovery: older versions may have stored the upstream pid on a
	// different (vendor-local) task id, while the client polls using the task_store id.
	if (refForLog && !pid) {
		try {
			const stored = await getTaskResultByTaskId(c.env.DB, userId, taskId);
			const parsed = stored?.result ? safeParseJsonForTask(stored.result) : null;
			const rawObj =
				parsed && typeof parsed === "object" && (parsed as any).raw
					? (parsed as any).raw
					: null;
			const coerceId = (value: any): string | null => {
				if (typeof value !== "string") return null;
				const trimmed = value.trim();
				return trimmed ? trimmed : null;
			};
			const linkedTaskId =
				coerceId(rawObj?.vendorTaskId) ||
				coerceId(rawObj?.taskId) ||
				coerceId(rawObj?.upstreamTaskId) ||
				null;
			if (linkedTaskId && linkedTaskId !== taskId.trim()) {
				const linkedRef = await getVendorTaskRefByTaskId(
					c.env.DB,
					userId,
					"image",
					linkedTaskId,
				).catch(() => null);
				const linkedPid =
					typeof linkedRef?.pid === "string" ? linkedRef.pid.trim() : "";
					if (linkedPid) {
						pid = linkedPid;
					if (
						typeof linkedRef?.vendor === "string" &&
						linkedRef.vendor.trim()
					) {
						vendorForLog = linkedRef.vendor.trim();
						const hint = extractChannelVendor(vendorForLog);
						if (hint) {
							try {
								c.set("proxyVendorHint", hint);
							} catch {
								// ignore
							}
						}
					}
						await upsertVendorTaskRefWithWarn(c, {
							userId,
							kind: "image",
							taskId: taskId.trim(),
							vendor: vendorForLog,
							pid,
							warnTag: "upsert linked image pid failed",
						});
					}
			}
		} catch {
			// ignore
		}
	}
	if (refForLog && !pid) {
		const result = TaskResultSchema.parse({
			id: taskId,
			kind: taskKind,
			status: "running",
			assets: [],
			raw: {
				provider: "grsai",
				vendor: vendorForLog,
				upstreamTaskId: null,
				waitingUpstreamTaskId: true,
			},
		});
		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind,
			result,
		});
		return result;
	}
	const upstreamTaskId = pid || taskId.trim();

	const ctx = await resolveVendorContext(c, userId, "gemini");
	if (ctx.viaProxyVendor === "comfly") {
		throw new AppError("comfly 代理暂不支持 /v1/draw/result 查询", {
			status: 400,
			code: "draw_result_not_supported",
		});
	}

	const baseUrl = normalizeBaseUrl(ctx.baseUrl) || "https://api.grsai.com";
	const isApimartBase =
		isApimartBaseUrl(baseUrl) || ctx.viaProxyVendor === "apimart";
	if (vendorForLog === "grsai" && isApimartBase) {
		vendorForLog = "apimart";
	}
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError(
			isApimartBase ? "未配置 apimart API Key" : "未配置 grsai API Key",
			{
			status: 400,
			code: "banana_api_key_missing",
			},
		);
	}

	if (isApimartBase) {
		const wrapper = await callJsonApi(
			c,
			`${normalizeApimartBaseUrl(baseUrl)}/v1/tasks/${encodeURIComponent(
				upstreamTaskId,
			)}?language=zh`,
			{
				method: "GET",
				headers: { Authorization: `Bearer ${apiKey}` },
			},
			{ provider: "apimart" },
		);

		if (typeof wrapper?.code === "number" && wrapper.code !== 200) {
			throw new AppError(
				(wrapper?.error?.message ||
					wrapper?.message ||
					`apimart 任务查询失败: code ${wrapper.code}`) as string,
				{
					status: 502,
					code: "apimart_result_failed",
					details: { upstreamData: wrapper ?? null },
				},
			);
		}

		const payload =
			wrapper && typeof wrapper === "object" && wrapper.data
				? wrapper.data
				: wrapper ?? {};
		let status = normalizeApimartTaskStatus(payload?.status);
		const progress = clampProgress(
			typeof payload?.progress === "number" ? payload.progress : undefined,
		);

		const urls = extractApimartMediaUrls(payload, "images");
		if (urls.length > 0 && status !== "failed") {
			status = "succeeded";
		}
		if (status === "succeeded" && urls.length === 0) {
			status = "running";
		}

		const failureReasonRaw =
			(typeof payload?.error?.message === "string" &&
				payload.error.message.trim()) ||
			(typeof payload?.error?.type === "string" &&
				payload.error.type.trim()) ||
			(typeof wrapper?.error?.message === "string" &&
				wrapper.error.message.trim()) ||
			null;

		let assets: Array<ReturnType<typeof TaskAssetSchema.parse>> = [];
		if (status === "succeeded" && urls.length > 0) {
			assets = urls.map((url) =>
				TaskAssetSchema.parse({ type: "image", url, thumbnailUrl: null }),
			);
			const promptForAsset =
				(typeof options?.promptFromClient === "string" &&
					options.promptFromClient.trim()) ||
				null;
			assets = await stageTaskAssetsForAsyncHosting({
				c,
				userId,
				assets,
				meta: {
					taskKind,
					prompt: promptForAsset,
					vendor: vendorForLog,
					taskId: taskId ?? null,
				},
			});
		}

		const result = TaskResultSchema.parse({
			id: taskId,
			kind: taskKind,
			status,
			assets,
			raw: {
				provider: "apimart",
				vendor: vendorForLog,
				upstreamTaskId,
				response: payload,
				progress,
				failureReason: failureReasonRaw,
				wrapper: wrapper ?? null,
			},
		});

		await recordVendorCallForTaskResult(c, {
			userId,
			vendor: vendorForLog,
			taskKind,
			result,
		});

		return result;
	}

	let res: Response;
	let data: any = null;
	try {
		res = await fetchWithHttpDebugLog(
			c,
			`${baseUrl.replace(/\/+$/, "")}/v1/draw/result`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ id: upstreamTaskId }),
			},
			{ tag: "grsai:drawResult" },
		);
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("grsai 任务查询失败", {
			status: 502,
			code: "grsai_result_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(data &&
				(data.error?.message ||
					data.message ||
					data.error ||
					data.error_message)) ||
			`grsai 任务查询失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "grsai_result_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const payload =
		data && typeof data === "object" && data.data ? data.data : data ?? {};

	const statusRaw =
		(typeof payload?.status === "string" && payload.status.trim()) ||
		(typeof data?.status === "string" && data.status.trim()) ||
		null;
	let status = normalizeGrsaiDrawTaskStatus(statusRaw);

	const progress = clampProgress(
		typeof payload?.progress === "number"
			? payload.progress <= 1
				? payload.progress * 100
				: payload.progress
			: typeof payload?.progress_pct === "number"
				? payload.progress_pct <= 1
					? payload.progress_pct * 100
					: payload.progress_pct
				: undefined,
	);

	const urls = extractBananaImageUrls(payload);
	if (urls.length > 0 && status !== "failed") {
		status = "succeeded";
	}

	const failureReasonRaw =
		(typeof payload?.failure_reason === "string" &&
			payload.failure_reason.trim()) ||
		(typeof payload?.error === "string" && payload.error.trim()) ||
		(typeof payload?.message === "string" && payload.message.trim()) ||
		(typeof data?.error === "string" && data.error.trim()) ||
		null;

	let assets: Array<ReturnType<typeof TaskAssetSchema.parse>> = [];
	if (status === "succeeded" && urls.length > 0) {
		assets = urls.map((url) =>
			TaskAssetSchema.parse({ type: "image", url, thumbnailUrl: null }),
		);
		const promptForAsset =
			(typeof options?.promptFromClient === "string" &&
				options.promptFromClient.trim()) ||
			(typeof payload?.prompt === "string" && payload.prompt.trim()) ||
			null;
		assets = await stageTaskAssetsForAsyncHosting({
			c,
			userId,
			assets,
			meta: {
				taskKind,
				prompt: promptForAsset,
				vendor: vendorForLog,
				taskId: taskId ?? null,
			},
		});
	}

	const result = TaskResultSchema.parse({
		id: taskId,
		kind: taskKind,
		status,
		assets,
		raw: {
			provider: "grsai",
			vendor: vendorForLog,
			upstreamTaskId,
			response: payload,
			progress,
			failureReason: failureReasonRaw,
			wrapper: data ?? null,
		},
	});

	await recordVendorCallForTaskResult(c, {
		userId,
		vendor: vendorForLog,
		taskKind,
		result,
	});

	return result;
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
		const extras = (req.extras || {}) as Record<string, any>;
		const modelRaw =
			(typeof extras.modelKey === "string" && extras.modelKey.trim()) || "";
		const model = normalizeMiniMaxModelKey(modelRaw);
		const required = await resolveTeamCreditsCostForTask(c, {
			taskKind: req.kind,
			modelKey: model,
		});
		const progressCtx = extractProgressContext(req, "minimax");

		const ctx = await resolveVendorContext(c, userId, "minimax");
		const baseUrl = normalizeBaseUrl(ctx.baseUrl);
		const channelVendor: "grsai" | "comfly" | null =
			ctx.viaProxyVendor === "comfly"
				? "comfly"
				: isGrsaiBaseUrl(baseUrl) || ctx.viaProxyVendor === "grsai"
					? "grsai"
					: null;
		const apiKey = ctx.apiKey.trim();
		if (!baseUrl || !apiKey) {
			throw new AppError("未配置 MiniMax API Key", {
				status: 400,
				code: "minimax_api_key_missing",
			});
		}
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

		const reservation = await requireSufficientTeamCredits(c, userId, {
			required,
			taskKind: req.kind,
			vendor: "minimax",
			modelKey: model,
		});
		emitProgress(userId, progressCtx, { status: "queued", progress: 0 });
		emitProgress(userId, progressCtx, { status: "running", progress: 5 });

		try {
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

	const result = TaskResultSchema.parse({
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
	await bindReservationToTaskId(c, userId, reservation, taskId);
		await recordVendorCallsForTaskResult(c, {
			userId,
			taskKind: req.kind,
			result,
			vendors: ["minimax", channelVendor],
		});
		return result;
		} catch (err) {
			return await releaseReservationOnThrow(c, userId, reservation, err);
		}
}

function normalizeTuziVideoTaskStatus(value: unknown): TaskStatus {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (!normalized) return "running";
		if (
			normalized === "queued" ||
			normalized === "pending" ||
			normalized === "submitted" ||
			normalized === "waiting"
		) {
			return "queued";
		}
		if (
			normalized === "running" ||
			normalized === "processing" ||
			normalized === "generating" ||
			normalized === "in_progress" ||
			normalized === "in-progress"
		) {
			return "running";
		}
		if (
			normalized === "completed" ||
			normalized === "complete" ||
			normalized === "succeeded" ||
			normalized === "success" ||
			normalized === "done"
		) {
			return "succeeded";
		}
		if (
			normalized === "failed" ||
			normalized === "failure" ||
			normalized === "error" ||
			normalized === "cancelled" ||
			normalized === "canceled"
		) {
			return "failed";
		}
		return "running";
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		const code = Math.floor(value);
		if (code === 0) return "queued";
		if (code === 1) return "running";
		if (code === 2) return "succeeded";
		if (code === 3 || code === -1) return "failed";
	}
	return "running";
}

function normalizeTuziVideoSeconds(
	requestedSeconds: number | null | undefined,
	isProModel: boolean,
): string {
	const requested =
		typeof requestedSeconds === "number" && Number.isFinite(requestedSeconds)
			? Math.max(1, Math.floor(requestedSeconds))
			: 10;

	// Explicit opt-in for OpenAI group seconds (4/8/12).
	if (requested === 4 || requested === 8 || requested === 12) {
		return String(requested);
	}
	if (requested <= 10) return "10";
	if (requested <= 15) return "15";
	return isProModel ? "25" : "15";
}

function normalizeTuziVideoSize(input: {
	sizeRaw: unknown;
	orientation: "portrait" | "landscape";
	isProModel: boolean;
}): string {
	const allowed = input.isProModel
		? new Set(["1280x720", "720x1280", "1024x1792", "1792x1024"])
		: new Set(["1280x720", "720x1280"]);
	const raw = typeof input.sizeRaw === "string" ? input.sizeRaw.trim() : "";
	const compact =
		raw && /^\d+\s*x\s*\d+$/i.test(raw) ? raw.replace(/\s+/g, "") : "";
	if (compact && allowed.has(compact)) return compact;

	const wantsHd = (() => {
		const lowered = raw.toLowerCase();
		if (lowered === "large" || lowered === "hd" || lowered === "high") return true;
		return false;
	})();

	if (input.orientation === "portrait") {
		return input.isProModel && wantsHd ? "1024x1792" : "720x1280";
	}
	return input.isProModel && wantsHd ? "1792x1024" : "1280x720";
}

async function runTuziVideoTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const v = "tuzi";
	const ctx = await resolveVendorContext(c, userId, v);
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = (ctx.apiKey || "").trim();
	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}
	if (!apiKey) {
		throw new AppError(`No API key configured for vendor ${v}`, {
			status: 400,
			code: "api_key_missing",
		});
	}

	const explicitModelKey = pickModelKey(req, { modelKey: undefined });
	const modelKeyRaw =
		explicitModelKey ||
		(await resolveDefaultModelKeyFromCatalogForVendor(c, v, "video"));
	const model = modelKeyRaw?.startsWith("models/") ? modelKeyRaw.slice(7) : modelKeyRaw;
	if (!model) {
		throw new AppError(
			"未配置可用的模型（请在 /stats -> 模型管理（系统级）为该厂商添加并启用 video 模型，或在请求里传 extras.modelKey）",
			{
				status: 400,
				code: "model_not_configured",
				details: { vendor: v, taskKind: req.kind },
			},
		);
	}
	const normalizedModel = model.toLowerCase();
	if (normalizedModel !== "sora-2" && normalizedModel !== "sora-2-pro") {
		throw new AppError("Tuzi /v1/videos 仅支持 sora-2 / sora-2-pro", {
			status: 400,
			code: "invalid_model",
			details: { vendor: v, model },
		});
	}
	const isProModel = normalizedModel === "sora-2-pro";

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: v,
		modelKey: model,
	});

	try {
		const extras = (req.extras || {}) as Record<string, any>;
		const orientation = (() => {
			const raw =
				(typeof extras.orientation === "string" && extras.orientation.trim()) ||
				(typeof extras.videoOrientation === "string" &&
					extras.videoOrientation.trim()) ||
				"";
			if (raw === "portrait" || raw === "landscape") return raw;
			const ratio =
				(typeof extras.aspectRatio === "string" && extras.aspectRatio.trim()) ||
				(typeof extras.aspect_ratio === "string" && extras.aspect_ratio.trim()) ||
				"";
			if (ratio === "9:16") return "portrait";
			if (ratio === "16:9") return "landscape";
			return "landscape";
		})();

		const durationSeconds =
			typeof (req as any).durationSeconds === "number" &&
			Number.isFinite((req as any).durationSeconds)
				? (req as any).durationSeconds
				: typeof extras.durationSeconds === "number" &&
						Number.isFinite(extras.durationSeconds)
					? extras.durationSeconds
					: 10;
		const seconds = normalizeTuziVideoSeconds(durationSeconds, isProModel);
		const size = normalizeTuziVideoSize({
			sizeRaw: extras.size,
			orientation,
			isProModel,
		});

		const inputReferenceRaw =
			(typeof extras.input_reference === "string" &&
				extras.input_reference.trim()) ||
			(typeof extras.inputReference === "string" &&
				extras.inputReference.trim()) ||
			(typeof extras.firstFrameUrl === "string" &&
				extras.firstFrameUrl.trim()) ||
			(typeof extras.url === "string" && extras.url.trim()) ||
			(Array.isArray(extras.urls) && extras.urls[0]
				? String(extras.urls[0]).trim()
				: "") ||
			"";
		const inputReferenceUrl = inputReferenceRaw ? String(inputReferenceRaw).trim() : "";
		if (inputReferenceUrl && /^blob:/i.test(inputReferenceUrl)) {
			throw new AppError("Tuzi input_reference 不支持 blob: URL，请先上传为可访问的图片地址", {
				status: 400,
				code: "tuzi_input_reference_invalid",
			});
		}

		const absoluteInputReference = (() => {
			if (!inputReferenceUrl) return null;
			if (/^https?:\/\//i.test(inputReferenceUrl)) return inputReferenceUrl;
			if (inputReferenceUrl.startsWith("/")) {
				return new URL(inputReferenceUrl, new URL(c.req.url).origin).toString();
			}
			return inputReferenceUrl;
		})();

		const form = new FormData();
		form.append("model", model);
		form.append("prompt", req.prompt);
		form.append("seconds", seconds);
		form.append("size", size);
		if (absoluteInputReference) {
			// NOTE: Tuzi upstream validates `input_reference` as a file part (multipart/form-data).
			// Callers must provide a real image file payload. Do not degrade to uploading the URL
			// string as text/plain, because that hides the actual fetch/content-type problem.
			const ref = absoluteInputReference.trim();
			const filePart = await (async (): Promise<{
				blob: Blob;
				filename: string;
				meta: { url: string; mode: "fetched_file" | "data_url_file" };
			}> => {
				const dataUrlMatch = ref.match(/^data:([^;]+);base64,(.+)$/i);
					if (dataUrlMatch) {
						const mimeType =
							normalizeMimeType(dataUrlMatch[1]) || "application/octet-stream";
						if (!isSupportedImageMimeType(mimeType)) {
							throw new AppError(
								`Tuzi input_reference 文件类型不受支持: ${mimeType}。仅支持 image/jpeg、image/png、image/webp`,
								{
									status: 400,
									code: "tuzi_input_reference_invalid_mime",
									details: { contentType: mimeType, source: ref.slice(0, 160) },
								},
							);
						}
						const base64 = (dataUrlMatch[2] || "").trim();
						const bytes = decodeBase64ToBytes(base64);
						const blobBytes = new Uint8Array(bytes);
						const ext = detectImageExtensionFromMimeType(mimeType);
						return {
							blob: new Blob([blobBytes], { type: mimeType }),
							filename: `input_reference.${ext || "bin"}`,
							meta: { url: ref.slice(0, 64), mode: "data_url_file" },
						};
					}

				if (/^https?:\/\//i.test(ref)) {
					let res: Response;
					try {
						res = await fetchWithHttpDebugLog(
							c,
							ref,
							{ method: "GET", headers: { Accept: "image/*,*/*;q=0.8" } },
							{ tag: "tuzi:input_reference:fetch" },
						);
					} catch (error: any) {
						throw new AppError("Tuzi input_reference 下载失败", {
							status: 502,
							code: "tuzi_input_reference_fetch_failed",
							details: { message: error?.message ?? String(error), source: ref.slice(0, 160) },
						});
					}
					if (!res.ok) {
						throw new AppError(`Tuzi input_reference 下载失败: ${res.status}`, {
							status: 502,
							code: "tuzi_input_reference_fetch_failed",
							details: { upstreamStatus: res.status, source: ref.slice(0, 160) },
						});
					}
					const contentType =
						normalizeMimeType(res.headers.get("content-type")) ||
						"application/octet-stream";
					if (!isSupportedImageMimeType(contentType)) {
						throw new AppError(
							`Tuzi input_reference 文件类型不受支持: ${contentType}。仅支持 image/jpeg、image/png、image/webp`,
							{
								status: 400,
								code: "tuzi_input_reference_invalid_mime",
								details: { contentType, source: ref.slice(0, 160) },
							},
						);
					}
					const buf = await res.arrayBuffer();
					const extFromUrl = (() => {
						try {
							const pathname = new URL(ref).pathname || "";
							const m = pathname.match(/\.([a-zA-Z0-9]+)$/);
							return m && m[1] ? m[1].toLowerCase() : null;
						} catch {
							return null;
						}
					})();
					const ext = extFromUrl || detectImageExtensionFromMimeType(contentType);
					return {
						blob: new Blob([buf], { type: contentType }),
						filename: `input_reference.${ext || "bin"}`,
						meta: { url: ref, mode: "fetched_file" },
					};
				}

				throw new AppError("Tuzi input_reference 仅支持 http(s) URL 或 data:image/*;base64", {
					status: 400,
					code: "tuzi_input_reference_invalid",
					details: { source: ref.slice(0, 160) },
				});
			})();

			form.append("input_reference", filePart.blob, filePart.filename);
		}

		const url = new URL("/v1/videos", baseUrl).toString();
		let res: Response;
		let data: any = null;
		try {
			res = await fetchWithHttpDebugLog(
				c,
				url,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						Accept: "application/json",
					},
					body: form,
				},
				{ tag: "tuzi:videos:create" },
			);
			try {
				data = await res.json();
			} catch {
				data = null;
			}
		} catch (error: any) {
			throw new AppError("Tuzi 视频任务创建失败", {
				status: 502,
				code: "tuzi_request_failed",
				details: { message: error?.message ?? String(error) },
			});
		}

		if (!res.ok) {
			const msg =
				(data && (data.error?.message || data.message || data.error)) ||
				`Tuzi 视频任务创建失败：${res.status}`;
			throw new AppError(msg, {
				status: res.status,
				code: "tuzi_request_failed",
				details: { upstreamStatus: res.status, upstreamData: data ?? null },
			});
		}

		const taskId =
			(typeof data?.id === "string" && data.id.trim()) ||
			(typeof data?.task_id === "string" && data.task_id.trim()) ||
			(typeof data?.taskId === "string" && data.taskId.trim()) ||
			null;
		if (!taskId) {
			throw new AppError("Tuzi API 未返回任务 ID", {
				status: 502,
				code: "tuzi_task_id_missing",
				details: { upstreamData: data ?? null },
			});
		}

		await upsertVendorTaskRefWithWarn(c, {
			userId,
			kind: "video",
			taskId,
			vendor: "tuzi",
			warnTag: "upsert tuzi video ref failed",
		});

		await bindReservationToTaskId(c, userId, reservation, taskId);

		const status = normalizeTuziVideoTaskStatus(data?.status);
		return TaskResultSchema.parse({
			id: taskId,
			kind: req.kind,
			status,
			assets: [],
			raw: {
				provider: "tuzi",
				vendor: "tuzi",
				model,
				request: {
					seconds,
					size,
					input_reference: absoluteInputReference,
				},
				response: data ?? null,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
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
	{
		const mapped = await fetchMappedTaskResultForVendor(c, userId, "minimax", {
			taskId,
			taskKind: "text_to_video",
			kindHint: "video",
		});
		if (mapped) return mapped;
	}

	const ctx = await resolveVendorContext(c, userId, "minimax");
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const channelVendor: "grsai" | "comfly" | null =
		ctx.viaProxyVendor === "comfly"
			? "comfly"
			: isGrsaiBaseUrl(baseUrl) || ctx.viaProxyVendor === "grsai"
				? "grsai"
				: null;
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
		const result = TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "failed",
			assets: [],
			raw: {
				provider: "minimax",
				model:
					typeof payload?.model === "string" && payload.model.trim()
						? payload.model.trim()
						: undefined,
				response: payload,
				progress,
				message: msg,
			},
		});
		await recordVendorCallsForTaskResult(c, {
			userId,
			taskKind: "text_to_video",
			result,
			vendors: ["minimax", channelVendor],
		});
		return result;
	}

	// Some gateways may not provide a reliable `status` field; when a video URL exists,
	// treat the task as succeeded to unblock the frontend polling loop.
		if (videoUrlFromPayload) {
		const asset = TaskAssetSchema.parse({
			type: "video",
			url: videoUrlFromPayload,
			thumbnailUrl: null,
		});
		const stagedAssets = await stageTaskAssetsForAsyncHosting({
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

		const result = TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "succeeded",
			assets: stagedAssets,
			raw: {
				provider: "minimax",
				model:
					typeof payload?.model === "string" && payload.model.trim()
						? payload.model.trim()
						: undefined,
				response: payload,
				hosting: { status: "pending", mode: "async" },
			},
		});
		await recordVendorCallsForTaskResult(c, {
			userId,
			taskKind: "text_to_video",
			result,
			vendors: ["minimax", channelVendor],
		});
		return result;
	}

	if (status !== "succeeded") {
		const result = TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status,
			assets: [],
			raw: {
				provider: "minimax",
				model:
					typeof payload?.model === "string" && payload.model.trim()
						? payload.model.trim()
						: undefined,
				response: payload,
				progress,
			},
		});
		await recordVendorCallsForTaskResult(c, {
			userId,
			taskKind: "text_to_video",
			result,
			vendors: ["minimax", channelVendor],
		});
		return result;
	}

	const videoUrl = videoUrlFromPayload;
	if (!videoUrl) {
		const result = TaskResultSchema.parse({
			id: taskId,
			kind: "text_to_video",
			status: "failed",
			assets: [],
			raw: {
				provider: "minimax",
				model:
					typeof payload?.model === "string" && payload.model.trim()
						? payload.model.trim()
						: undefined,
				response: payload,
				progress,
				message:
					"MiniMax 任务已完成但未返回视频链接（缺少 url/video_url）",
			},
		});
		await recordVendorCallsForTaskResult(c, {
			userId,
			taskKind: "text_to_video",
			result,
			vendors: ["minimax", channelVendor],
		});
		return result;
	}

	const asset = TaskAssetSchema.parse({
		type: "video",
		url: videoUrl,
		thumbnailUrl: null,
	});
	const stagedAssets = await stageTaskAssetsForAsyncHosting({
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

	const result = TaskResultSchema.parse({
		id: taskId,
		kind: "text_to_video",
		status: "succeeded",
		assets: stagedAssets,
		raw: {
			provider: "minimax",
			model:
				typeof payload?.model === "string" && payload.model.trim()
					? payload.model.trim()
					: undefined,
			response: payload,
			hosting: { status: "pending", mode: "async" },
		},
	});
	await recordVendorCallsForTaskResult(c, {
		userId,
		taskKind: "text_to_video",
		result,
		vendors: ["minimax", channelVendor],
	});
	return result;
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

function buildOpenAIChatCompletionsUrlForTask(baseUrl?: string | null): string {
	const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
	if (!raw) return "https://api.openai.com/v1/chat/completions";
	if (/\/chat\/completions$/i.test(raw)) return raw;
	// If base already contains a version segment (e.g. /v1 or /v1/openai), do not append another /v1.
	const hasVersionSegment = /\/v\d+(?:beta)?(\/|$)/i.test(raw);
	return `${raw}${hasVersionSegment ? "" : "/v1"}/chat/completions`;
}

	function buildOpenAIImagesGenerationsUrlForTask(baseUrl?: string | null): string {
		const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
		if (!raw) return "https://api.openai.com/v1/images/generations";
		if (/\/images\/generations$/i.test(raw)) return raw;
		const hasVersionSegment = /\/v\d+(?:beta)?(\/|$)/i.test(raw);
		return `${raw}${hasVersionSegment ? "" : "/v1"}/images/generations`;
	}

	function buildOpenAIImagesEditsUrlForTask(baseUrl?: string | null): string {
		const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
		if (!raw) return "https://api.openai.com/v1/images/edits";
		if (/\/images\/edits$/i.test(raw)) return raw;
		const hasVersionSegment = /\/v\d+(?:beta)?(\/|$)/i.test(raw);
		return `${raw}${hasVersionSegment ? "" : "/v1"}/images/edits`;
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

type ModelCatalogVendorAuthForTask = {
	authType: "none" | "bearer" | "x-api-key" | "query";
	authHeader: string | null;
	authQueryParam: string | null;
};

async function resolveModelCatalogVendorAuthForTask(
	c: AppContext,
	vendorKey: string,
): Promise<ModelCatalogVendorAuthForTask | null> {
	const vk = normalizeVendorKey(vendorKey);
	if (!vk) return null;
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const row = await getPrismaClient().model_catalog_vendors.findFirst({
			where: {
				key: {
					equals: vk,
					mode: "insensitive",
				},
			},
			select: {
				auth_type: true,
				auth_header: true,
				auth_query_param: true,
			},
		});
		if (!row) return null;
		const authTypeRaw =
			typeof row?.auth_type === "string" ? row.auth_type.trim().toLowerCase() : "";
		const authType =
			authTypeRaw === "none" ||
			authTypeRaw === "bearer" ||
			authTypeRaw === "x-api-key" ||
			authTypeRaw === "query"
				? (authTypeRaw as ModelCatalogVendorAuthForTask["authType"])
				: "bearer";
		const authHeader =
			typeof row?.auth_header === "string" && row.auth_header.trim()
				? row.auth_header.trim()
				: null;
		const authQueryParam =
			typeof row?.auth_query_param === "string" && row.auth_query_param.trim()
				? row.auth_query_param.trim()
				: null;
		return { authType, authHeader, authQueryParam };
	} catch {
		return null;
	}
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

async function hasEnabledModelCatalogKindForVendor(
	c: AppContext,
	vendorKey: string,
	kind: "text" | "image" | "video",
): Promise<boolean> {
	const vk = normalizeVendorKey(vendorKey);
	if (!vk) return false;
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const row = await getPrismaClient().model_catalog_models.findFirst({
			where: {
				vendor_key: { equals: vk, mode: "insensitive" },
				kind,
				enabled: 1,
			},
			select: { model_key: true },
		});
		return !!row?.model_key;
	} catch {
		return false;
	}
}

async function runOpenAiCompatibleTextTaskForVendor(
	c: AppContext,
	userId: string,
	vendorKey: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const v = normalizeVendorKey(vendorKey);
	const ctx = await resolveVendorContext(c, userId, v);
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = (ctx.apiKey || "").trim();
	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}
	if (!apiKey) {
		throw new AppError(`No API key configured for vendor ${v}`, {
			status: 400,
			code: "api_key_missing",
		});
	}

	const explicitModelKey = pickModelKey(req, { modelKey: undefined });
	const modelKeyRaw =
		explicitModelKey ||
		(await resolveDefaultModelKeyFromCatalogForVendor(c, v, "text")) ||
		(await resolveDefaultModelKeyFromCatalogForVendor(c, v, "image"));
	const model = modelKeyRaw?.startsWith("models/") ? modelKeyRaw.slice(7) : modelKeyRaw;
	if (!model) {
		throw new AppError(
			"未配置可用的模型（请在 /stats -> 模型管理（系统级）为该厂商添加并启用 text/image 模型，或在请求里传 extras.modelKey）",
			{
				status: 400,
				code: "model_not_configured",
				details: { vendor: v, taskKind: req.kind },
			},
		);
	}

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: v,
		modelKey: model,
	});

	try {
		const systemPrompt =
			req.kind === "prompt_refine"
				? pickSystemPrompt(
						req,
						"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
					)
				: pickSystemPrompt(req, "请用中文回答。");

		const extras = (req.extras || {}) as Record<string, any>;
		const temperature = normalizeTemperature(extras.temperature, 0.7);

		const messages: OpenAIChatMessageForTask[] = [];
		if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
		messages.push({ role: "user", content: req.prompt });

		let url = buildOpenAIChatCompletionsUrlForTask(baseUrl);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		const auth = await resolveModelCatalogVendorAuthForTask(c, v);
		if (auth?.authType === "none") {
			// no-op
		} else if (auth?.authType === "query") {
			const param = auth.authQueryParam || "api_key";
			const u = new URL(url);
			u.searchParams.set(param, apiKey);
			url = u.toString();
		} else if (auth?.authType === "x-api-key") {
			const header = auth.authHeader || "X-API-Key";
			headers[header] = apiKey;
		} else {
			const header = auth?.authHeader || "Authorization";
			headers[header] = `Bearer ${apiKey}`;
		}

		const body = {
			model,
			messages,
			stream: false,
			temperature,
		};

		const data = await callJsonApi(
			c,
			url,
			{
				method: "POST",
				headers,
				body: JSON.stringify(body),
			},
			{ provider: v },
		);

		const text = extractTextFromOpenAIResponseForTask(data);
		const id =
			(typeof data?.id === "string" && data.id.trim()) ||
			`${v}-${Date.now().toString(36)}`;

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status: "succeeded",
			assets: [],
			raw: {
				provider: "openai_compat",
				vendor: v,
				model,
				response: data,
				text: text || "调用成功",
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

async function runOpenAiCompatibleImageToPromptTaskForVendor(
	c: AppContext,
	userId: string,
	vendorKey: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const v = normalizeVendorKey(vendorKey);
	const ctx = await resolveVendorContext(c, userId, v);
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = (ctx.apiKey || "").trim();
	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}
	if (!apiKey) {
		throw new AppError(`No API key configured for vendor ${v}`, {
			status: 400,
			code: "api_key_missing",
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

	const explicitModelKey = pickModelKey(req, { modelKey: undefined });
	const modelKeyRaw = await (async () => {
		if (explicitModelKey) return explicitModelKey;
		const textModel = await resolveDefaultModelKeyFromCatalogForVendor(c, v, "text");
		if (textModel) return textModel;
		// Compatibility: allow using image-kind models for image_to_prompt (many vendors classify
		// multimodal models as "image" in the catalog).
		return await resolveDefaultModelKeyFromCatalogForVendor(c, v, "image");
	})();
	const model = modelKeyRaw?.startsWith("models/") ? modelKeyRaw.slice(7) : modelKeyRaw;
	if (!model) {
		throw new AppError(
			"未配置可用的模型（请在 /stats -> 模型管理（系统级）为该厂商添加并启用 text/image 模型，或在请求里传 extras.modelKey）",
			{
				status: 400,
				code: "model_not_configured",
				details: { vendor: v, taskKind: req.kind },
			},
		);
	}

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: v,
		modelKey: model,
	});

	try {
		const userPrompt =
			req.prompt?.trim() ||
			"Describe this image in rich detail and output a single, well-structured English prompt that can be used to recreate it. Do not add any explanations, headings, markdown formatting, or non-English text.";

		const systemPrompt = pickSystemPrompt(
			req,
			"You are an expert visual analyst. You must follow the user's instruction strictly and return output in exactly the format the user requests. If the user asks for JSON, return valid JSON only (no markdown, no extra text).",
		);

		const temperature = normalizeTemperature(extras.temperature, 0.2);
		const imageSource = imageData || imageUrl!;

		const messages: OpenAIChatMessageForTask[] = [];
		if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
		messages.push({
			role: "user",
			content: [
				{ type: "text", text: userPrompt },
				{
					type: "image_url",
					image_url: { url: imageSource },
				},
			],
		});

		let url = buildOpenAIChatCompletionsUrlForTask(baseUrl);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		const auth = await resolveModelCatalogVendorAuthForTask(c, v);
		if (auth?.authType === "none") {
			// no-op
		} else if (auth?.authType === "query") {
			const param = auth.authQueryParam || "api_key";
			const u = new URL(url);
			u.searchParams.set(param, apiKey);
			url = u.toString();
		} else if (auth?.authType === "x-api-key") {
			const header = auth.authHeader || "X-API-Key";
			headers[header] = apiKey;
		} else {
			const header = auth?.authHeader || "Authorization";
			headers[header] = `Bearer ${apiKey}`;
		}

		const body = {
			model,
			messages,
			stream: false,
			temperature,
		};

		const data = await callJsonApi(
			c,
			url,
			{
				method: "POST",
				headers,
				body: JSON.stringify(body),
			},
			{ provider: v },
		);

		const rawText = extractTextFromOpenAIResponseForTask(data);
		const text = normalizeImagePromptOutputForTask(rawText);
		const id =
			(typeof data?.id === "string" && data.id.trim()) ||
			`${v}-img-${Date.now().toString(36)}`;

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status: "succeeded",
			assets: [],
			raw: {
				provider: "openai_compat",
				vendor: v,
				model,
				response: data,
				rawText,
				text,
				imageSource,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

async function runOpenAiCompatibleImageTaskForVendor(
	c: AppContext,
	userId: string,
	vendorKey: string,
	req: TaskRequestDto,
	options?: { forceTaskId?: string | null },
): Promise<TaskResult> {
	const v = normalizeVendorKey(vendorKey);
	const forcedTaskId =
		typeof options?.forceTaskId === "string" && options.forceTaskId.trim()
			? options.forceTaskId.trim()
			: null;
	const ctx = await resolveVendorContext(c, userId, v);
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = (ctx.apiKey || "").trim();
	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}
	if (!apiKey) {
		throw new AppError(`No API key configured for vendor ${v}`, {
			status: 400,
			code: "api_key_missing",
		});
	}

	const explicitModelKey = pickModelKey(req, { modelKey: undefined });
	const modelKeyRaw =
		explicitModelKey ||
		(await resolveDefaultModelKeyFromCatalogForVendor(c, v, "image"));
	const model = modelKeyRaw?.startsWith("models/") ? modelKeyRaw.slice(7) : modelKeyRaw;
	if (!model) {
		throw new AppError(
			"未配置可用的模型（请在 /stats -> 模型管理（系统级）为该厂商添加并启用 image 模型，或在请求里传 extras.modelKey）",
			{
				status: 400,
				code: "model_not_configured",
				details: { vendor: v, taskKind: req.kind },
			},
		);
	}

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: v,
		modelKey: model,
	});

	try {
		const normalizeGeminiCompatibleBaseUrl = (raw: string): string => {
			const trimmed = normalizeGeminiBaseUrl(raw).trim().replace(/\/+$/, "");
			if (!trimmed) return trimmed;
			// Some providers reuse the same base URL for OpenAI-compatible paths (e.g. /v1/openai).
			// Gemini generateContent endpoints require the root base.
			return trimmed
				.replace(/\/openai\/v\d+(?:beta)?$/i, "")
				.replace(/\/v\d+(?:beta)?\/openai$/i, "")
				.replace(/\/openai$/i, "")
				.replace(/\/v\d+(?:beta)?$/i, "");
		};

		const redactGeminiInlineData = (value: any): any => {
			if (!value || typeof value !== "object") return value;
			const inline = (value as any).inlineData || (value as any).inline_data || null;
			if (!inline || typeof inline !== "object") return value;
			const b64 = typeof (inline as any).data === "string" ? (inline as any).data : "";
			const mimeType =
				typeof (inline as any).mimeType === "string"
					? (inline as any).mimeType
					: typeof (inline as any).mime_type === "string"
						? (inline as any).mime_type
						: null;
			const redacted = {
				inlineData: {
					mimeType,
					data: b64 ? `[omitted len=${b64.length}]` : "[omitted]",
					...(b64
						? {
								previewDataUrl: `data:${mimeType || "image/jpeg"};base64,${b64.replace(/\s+/g, "")}`,
							}
						: {}),
				},
			};
			return redacted;
		};

		const summarizeGeminiGenerateContentResponse = (data: any): any => {
			if (!data || typeof data !== "object") return data;
			const candidates = Array.isArray((data as any).candidates)
				? (data as any).candidates
				: [];
			return {
				candidates: candidates.slice(0, 4).map((c: any) => ({
					finishReason: c?.finishReason ?? c?.finish_reason ?? null,
					content: {
						role:
							typeof c?.content?.role === "string" ? c.content.role : null,
						parts: Array.isArray(c?.content?.parts)
							? c.content.parts.slice(0, 20).map((p: any) => {
									if (p && typeof p.text === "string") {
										const t = p.text.trim();
										return {
											text: t.length > 400 ? `${t.slice(0, 400)}…` : t,
										};
									}
									return redactGeminiInlineData(p);
								})
							: [],
					},
					usageMetadata: c?.usageMetadata ?? c?.usage_metadata ?? null,
				})),
				usageMetadata:
					(data as any).usageMetadata ?? (data as any).usage_metadata ?? null,
				modelVersion:
					(data as any).modelVersion ?? (data as any).model_version ?? null,
			};
		};

		const auth = await resolveModelCatalogVendorAuthForTask(c, v);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		const extras = (req.extras || {}) as Record<string, any>;
		const referenceImages = (() => {
			const urls: string[] = [];
			const pushAll = (value: any) => {
				const items = Array.isArray(value) ? value : [value];
				for (const item of items) {
					if (typeof item === "string" && item.trim()) urls.push(item.trim());
				}
			};
			pushAll(extras.referenceImages);
			pushAll((extras as any).reference_images);
			pushAll((extras as any).image_urls);
			pushAll((extras as any).imageUrls);
			pushAll((extras as any).urls);
			return Array.from(new Set(urls));
		})();

		if (v === "yunwu" && (req.kind === "text_to_image" || req.kind === "image_edit")) {
			const normalizedModel = String(model || "").trim();
			const isQwenImageEditModel = /^qwen-image-edit\b/i.test(normalizedModel);

			// Yunwu Qwen image-edit uses an OpenAI-like images endpoint instead of Gemini generateContent.
			// Ref: /v1/images/generations { model, prompt, image(url) }.
			if (isQwenImageEditModel) {
				const image = (() => {
					let fallbackDataUrl = "";
					const candidates: any[] = [
						(extras as any).image,
						(extras as any).imageUrl,
						(extras as any).image_url,
						(extras as any).url,
						(extras as any).firstFrameUrl,
						...referenceImages,
					];
					for (const candidate of candidates) {
						if (typeof candidate !== "string") continue;
						const trimmed = candidate.trim();
						if (!trimmed) continue;
						if (/^data:image\//i.test(trimmed)) {
							if (!fallbackDataUrl) fallbackDataUrl = trimmed;
							continue;
						}
						return trimmed;
					}
					return fallbackDataUrl;
				})();

				if (!image && req.kind === "image_edit") {
					throw new AppError("qwen image_edit 需要提供参考图 URL（extras.image 或 extras.referenceImages）", {
						status: 400,
						code: "reference_images_missing",
						details: { vendor: v, model: normalizedModel, extrasKeys: Object.keys(extras || {}).sort() },
					});
				}

				const generatedId = `yunwu-qwen-img-${Date.now().toString(36)}-${crypto
					.randomUUID()
					.slice(0, 6)}`;
				const id = forcedTaskId || generatedId;

				// Normalize to the root base (some deployments configure baseUrl with /v1beta or /openai).
				let url = `${normalizeGeminiCompatibleBaseUrl(baseUrl)}/v1/images/generations`;
				if (auth?.authType === "none") {
					// no-op
				} else if (auth?.authType === "query") {
					const param = auth.authQueryParam || "key";
					const u = new URL(url);
					u.searchParams.set(param, apiKey);
					url = u.toString();
				} else if (auth?.authType === "x-api-key") {
					const header = auth.authHeader || "X-API-Key";
					headers[header] = apiKey;
				} else {
					const header = auth?.authHeader || "Authorization";
					headers[header] = `Bearer ${apiKey}`;
				}

				const body = {
					model: normalizedModel,
					prompt: String(req.prompt || ""),
					...(image ? { image } : {}),
				};

				const redactedBody = {
					...body,
					...(typeof (body as any).image === "string" &&
					/^data:image\//i.test(String((body as any).image))
						? {
								image: `[omitted len=${String((body as any).image).length}]`,
							}
						: {}),
				};

				let data: any = null;
				let upstreamError: any = null;
				try {
					data = await callJsonApi(
						c,
						url,
						{
							method: "POST",
							headers,
							body: JSON.stringify(body),
						},
						{ provider: v },
					);
				} catch (err) {
					upstreamError = err;
				}

				if (upstreamError) {
					const errMsg =
						typeof upstreamError?.message === "string" && upstreamError.message.trim()
							? upstreamError.message.trim()
							: "yunwu qwen /v1/images/generations 调用失败";

					await recordVendorCallPayloads(c, {
						userId,
						vendor: v,
						taskId: id,
						taskKind: req.kind,
						request: { url, body: redactedBody },
						upstreamResponse: {
							url,
							error: {
								message: errMsg,
								status:
									typeof upstreamError?.status === "number"
										? upstreamError.status
										: null,
								code:
									typeof upstreamError?.code === "string"
										? upstreamError.code
										: null,
							},
							details: upstreamError?.details ?? null,
						},
					});

					await bindReservationToTaskId(c, userId, reservation, id);
					return TaskResultSchema.parse({
						id,
						kind: req.kind,
						status: "failed",
						assets: [],
						raw: {
							provider: "yunwu_images",
							vendor: v,
							model: normalizedModel,
							failureReason: errMsg,
							error: {
								message: errMsg,
								status:
									typeof upstreamError?.status === "number"
										? upstreamError.status
										: null,
								code:
									typeof upstreamError?.code === "string"
										? upstreamError.code
										: null,
								details: upstreamError?.details ?? null,
							},
						},
					});
				}

				const urls = (() => {
					const out: string[] = [];
					const items = Array.isArray((data as any)?.data) ? (data as any).data : [];
					for (const item of items) {
						const u = typeof item?.url === "string" ? item.url.trim() : "";
						if (u) out.push(u);
					}
					const fallbackUrl =
						(typeof (data as any)?.url === "string" && (data as any).url.trim()) ||
						(typeof (data as any)?.result?.url === "string" &&
							(data as any).result.url.trim()) ||
						"";
					if (fallbackUrl) out.push(fallbackUrl);
					return Array.from(new Set(out));
				})();

				const assets = urls.map((u) =>
					TaskAssetSchema.parse({ type: "image", url: u, thumbnailUrl: null }),
				);
				const status: "succeeded" | "failed" = assets.length ? "succeeded" : "failed";

				await recordVendorCallPayloads(c, {
					userId,
					vendor: v,
					taskId: id,
					taskKind: req.kind,
					request: { url, body: redactedBody },
					upstreamResponse: { url, data },
				});

				await bindReservationToTaskId(c, userId, reservation, id);
				return TaskResultSchema.parse({
					id,
					kind: req.kind,
					status,
					assets,
					raw: {
						provider: "yunwu_images",
						vendor: v,
						model: normalizedModel,
						response: data,
					},
				});
			}

			const parseBase64DataUrl = (
				input: string,
			): { mimeType: string; base64: string } | null => {
				const trimmed = String(input || "").trim();
				if (!trimmed) return null;
				const match = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
				if (!match) return null;
				const mimeType = (match[1] || "").trim() || "application/octet-stream";
				const base64 = (match[2] || "").replace(/\s+/g, "");
				if (!base64) return null;
				return { mimeType, base64 };
			};

				const normalizeImageMimeType = (rawMimeType: unknown): string => {
					const mimeType = typeof rawMimeType === "string" ? rawMimeType.trim() : "";
					if (mimeType && /^image\//i.test(mimeType)) return mimeType;
					return "image/jpeg";
				};

					type YunwuInlineInputImage = { mimeType: string; base64: string; source: string };
					type YunwuFileInputImage = { mimeType: string; uri: string; source: string };

					const inferImageMimeTypeFromUrl = (value: string): string => {
						const raw = String(value || "").trim().toLowerCase();
						if (!raw) return "image/jpeg";
						if (/\.(png)(?:[?#]|$)/i.test(raw)) return "image/png";
						if (/\.(webp)(?:[?#]|$)/i.test(raw)) return "image/webp";
						if (/\.(gif)(?:[?#]|$)/i.test(raw)) return "image/gif";
						if (/\.(jpe?g)(?:[?#]|$)/i.test(raw)) return "image/jpeg";
						return "image/jpeg";
					};

					const resolveAbsoluteUrl = (raw: string): string => {
						let resolved = String(raw || "").trim();
						if (!resolved) return resolved;
						if (!resolved.startsWith("/")) return resolved;
						try {
							return new URL(resolved, new URL(c.req.url).origin).toString();
						} catch {
							return resolved;
						}
					};

					const dedupeBySource = <T extends { source: string }>(items: T[]): T[] => {
						const out: T[] = [];
						const seen = new Set<string>();
						for (const item of items) {
							const key = typeof item?.source === "string" ? item.source.trim() : "";
							if (!key || seen.has(key)) continue;
							seen.add(key);
							out.push(item);
						}
						return out;
					};

					const inlineImagesBase: YunwuInlineInputImage[] = [];
					const fileImagesBase: YunwuFileInputImage[] = [];
					const inputImagesFailedBase: Array<{ source: string; error: string }> = [];

					const inlineValue =
						(extras as any).inline_data ||
						(extras as any).inlineData ||
						(extras as any).inline ||
						null;

					if (inlineValue != null) {
						const items = Array.isArray(inlineValue) ? inlineValue : [inlineValue];
						for (const [idx, item] of items.entries()) {
							const source = `extras.inline_data[${idx}]`;
							try {
								if (item && typeof item === "object") {
									const dataRaw =
										typeof (item as any).data === "string"
											? String((item as any).data).trim()
											: "";
									if (!dataRaw) continue;

									const parsed = parseBase64DataUrl(dataRaw);
									if (parsed) {
										inlineImagesBase.push({
											mimeType: normalizeImageMimeType(parsed.mimeType),
											base64: parsed.base64,
											source,
										});
										continue;
									}

									const mimeType =
										(typeof (item as any).mimeType === "string" &&
											String((item as any).mimeType).trim()) ||
										(typeof (item as any).mime_type === "string" &&
											String((item as any).mime_type).trim()) ||
										"image/jpeg";
									inlineImagesBase.push({
										mimeType: normalizeImageMimeType(mimeType),
										base64: dataRaw.replace(/\s+/g, ""),
										source,
									});
									continue;
								}

								if (typeof item === "string" && item.trim()) {
									const dataRaw = item.trim();
									const parsed = parseBase64DataUrl(dataRaw);
									if (parsed) {
										inlineImagesBase.push({
											mimeType: normalizeImageMimeType(parsed.mimeType),
											base64: parsed.base64,
											source,
										});
										continue;
									}
									inlineImagesBase.push({
										mimeType: "image/jpeg",
										base64: dataRaw.replace(/\s+/g, ""),
										source,
									});
								}
							} catch (err: any) {
								const msg =
									typeof err?.message === "string" && err.message.trim()
										? err.message.trim()
										: String(err || "unknown error");
								inputImagesFailedBase.push({ source, error: msg });
							}
						}
					}

					if (referenceImages.length) {
						for (const [idx, raw] of referenceImages.entries()) {
							const source = `referenceImages[${idx}]`;
							const refRaw = String(raw || "").trim();
							if (!refRaw) {
								inputImagesFailedBase.push({ source, error: "参考图为空" });
								continue;
							}

							const ref = resolveAbsoluteUrl(refRaw);
							if (/^blob:/i.test(ref)) {
								inputImagesFailedBase.push({
									source: refRaw.slice(0, 160),
									error: "blob: URL 无法在 Worker 侧下载，请先上传为可访问的图片地址",
								});
								continue;
							}

							if (/^data:image\//i.test(ref)) {
								const parsed = parseBase64DataUrl(ref);
								if (!parsed) {
									inputImagesFailedBase.push({
										source: refRaw.slice(0, 160),
										error: "参考图无法解析为 data:image/*;base64",
									});
									continue;
								}
								inlineImagesBase.push({
									mimeType: normalizeImageMimeType(parsed.mimeType),
									base64: parsed.base64,
									source: refRaw,
								});
								continue;
							}

							if (!/^https?:\/\//i.test(ref)) {
								inputImagesFailedBase.push({
									source: refRaw.slice(0, 160),
									error: "参考图不是可访问的 http(s) URL",
								});
								continue;
							}

							fileImagesBase.push({
								mimeType: inferImageMimeTypeFromUrl(ref),
								uri: ref,
								source: ref,
							});
						}
					}

					const inlineImages = dedupeBySource(inlineImagesBase);
					const fileImages = dedupeBySource(fileImagesBase);
					const hasAnyInputImages = inlineImages.length > 0 || fileImages.length > 0;

					let cachedInlineResolution: {
						images: YunwuInlineInputImage[];
						failed: Array<{ source: string; error: string }>;
					} | null = null;

					const resolveInlineImages = async (): Promise<{
						images: YunwuInlineInputImage[];
						failed: Array<{ source: string; error: string }>;
					}> => {
						if (cachedInlineResolution) return cachedInlineResolution;
						const images: YunwuInlineInputImage[] = [...inlineImages];
						const failed: Array<{ source: string; error: string }> = [
							...inputImagesFailedBase,
						];

						if (fileImages.length) {
							const settled = await Promise.allSettled(
								fileImages.map(async (img) => {
									const dataUrl = await resolveSora2ApiImageUrl(c, img.uri);
									const parsed = parseBase64DataUrl(dataUrl);
									if (!parsed) {
										throw new AppError("参考图无法解析为 data:image/*;base64", {
											status: 400,
											code: "invalid_reference_image",
											details: { url: img.source.slice(0, 160) },
										});
									}
									return {
										mimeType: normalizeImageMimeType(parsed.mimeType),
										base64: parsed.base64,
										source: img.source,
									} satisfies YunwuInlineInputImage;
								}),
							);

							for (const [idx, item] of settled.entries()) {
								const src = fileImages[idx]?.source || `referenceImages[${idx}]`;
								if (item.status === "fulfilled") {
									images.push(item.value);
									continue;
								}
								const msg =
									typeof (item.reason as any)?.message === "string" &&
									(item.reason as any).message.trim()
										? (item.reason as any).message.trim()
										: String(item.reason || "unknown error");
								failed.push({ source: src, error: msg });
							}
						}

						const deduped = dedupeBySource(images);
						cachedInlineResolution = { images: deduped, failed };
						return cachedInlineResolution;
					};

			const aspectRatioRaw =
				(typeof extras.aspectRatio === "string" && extras.aspectRatio.trim()) ||
				(typeof (extras as any).aspect_ratio === "string" &&
					String((extras as any).aspect_ratio).trim()) ||
				"";
			const aspectRatioCandidate =
				aspectRatioRaw && aspectRatioRaw.toLowerCase() !== "auto" ? aspectRatioRaw : "";
			const aspectRatio =
				aspectRatioCandidate &&
				/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(aspectRatioCandidate)
					? aspectRatioCandidate
					: null;

			const imageSizeRaw =
				(typeof extras.imageSize === "string" && extras.imageSize.trim()) ||
				(typeof (extras as any).image_size === "string" &&
					String((extras as any).image_size).trim()) ||
				"";
			const isGemini25FlashImage = /^gemini-2\.5-flash-image\b/i.test(
				String(model || "").trim(),
			);
			const imageSize =
				!isGemini25FlashImage &&
				(imageSizeRaw === "512" ||
					imageSizeRaw === "1K" ||
					imageSizeRaw === "2K" ||
					imageSizeRaw === "4K")
					? imageSizeRaw
					: null;
			const imageResolutionRaw =
				(typeof (extras as any).imageResolution === "string" &&
					String((extras as any).imageResolution).trim()) ||
				(typeof extras.resolution === "string" && extras.resolution.trim()) ||
				(typeof (extras as any).image_resolution === "string" &&
					String((extras as any).image_resolution).trim()) ||
				"";
			const imageResolution =
				imageResolutionRaw === "512" ||
				imageResolutionRaw === "1K" ||
				imageResolutionRaw === "2K" ||
				imageResolutionRaw === "4K"
					? imageResolutionRaw
					: null;
			const hasExplicitImageConfig = Boolean(
				aspectRatio || imageSize || imageResolution,
			);

					if (req.kind === "image_edit" && !hasAnyInputImages) {
						throw new AppError(
							"yunwu 的 image_edit 需要提供 extras.referenceImages（或 extras.inline_data）",
							{
								status: 400,
								code: "reference_images_missing",
								details: {
									vendor: v,
									extrasKeys: Object.keys(extras || {}).sort(),
									...(inputImagesFailedBase.length
										? { referenceImagesFailed: inputImagesFailedBase }
										: {}),
								},
							},
						);
					}

			const modelPath = `models/${model}`;
			const geminiBase = normalizeGeminiCompatibleBaseUrl(baseUrl);
			const logUrl = `${geminiBase}/v1beta/${modelPath}:generateContent`;
			let url = logUrl;

			const promptText = (() => {
				const trimmed = String(req.prompt || "").trim();
				if (!trimmed) return trimmed;
				if (req.kind !== "text_to_image") return trimmed;
				// Gemini image models may return text-only when prompt is not explicit.
				return `请生成一张图片：${trimmed}`;
			})();

			if (auth?.authType === "none") {
				// no-op
			} else if (auth?.authType === "query") {
				const param = auth.authQueryParam || "key";
				const u = new URL(url);
				u.searchParams.set(param, apiKey);
				url = u.toString();
			} else if (auth?.authType === "x-api-key") {
				const header = auth.authHeader || "X-API-Key";
				headers[header] = apiKey;
				if (!auth.authHeader) headers["x-goog-api-key"] = apiKey;
			} else {
				const header = auth?.authHeader || "Authorization";
				headers[header] = `Bearer ${apiKey}`;
			}

			const generatedId = `yunwu-img-${Date.now().toString(36)}-${crypto
				.randomUUID()
				.slice(0, 6)}`;
			const id = forcedTaskId || generatedId;

				type YunwuGenerateContentPartsStyle = "snake" | "camel";
				type YunwuGenerateContentConfigMode = "full" | "minimal" | "none";
				type YunwuGenerateContentModalities = "image" | "text_image";
				type YunwuGenerateContentImageMode = "inline" | "file";

			const isInvalidArgumentError = (err: unknown): boolean => {
				if (!err || typeof err !== "object") return false;
				const anyErr: any = err;
				const msg =
					typeof anyErr.message === "string"
						? anyErr.message.toLowerCase()
						: "";
				if (msg.includes("invalid argument")) return true;
				const upstreamStatus =
					anyErr?.details?.upstreamData?.error?.status ??
					anyErr?.details?.upstreamData?.error?.status_code ??
					anyErr?.details?.upstreamData?.status ??
					anyErr?.details?.upstreamStatus ??
					null;
				if (
					typeof upstreamStatus === "string" &&
					upstreamStatus.toUpperCase().includes("INVALID_ARGUMENT")
				) {
					return true;
				}
				const upstreamCodeRaw =
					anyErr?.details?.upstreamData?.error?.code ??
					anyErr?.details?.upstreamData?.error?.statusCode ??
					anyErr?.details?.upstreamData?.error?.status_code ??
					null;
				const upstreamCode =
					typeof upstreamCodeRaw === "number"
						? upstreamCodeRaw
						: typeof upstreamCodeRaw === "string" &&
								/^\d+$/.test(upstreamCodeRaw.trim())
							? Number(upstreamCodeRaw.trim())
							: null;
				if (upstreamCode === 400) return true;
				return false;
			};

			const resolveUpstreamHttpStatus = (err: unknown): number | null => {
				if (!err || typeof err !== "object") return null;
				const anyErr: any = err;
				const direct =
					typeof anyErr.status === "number" && Number.isFinite(anyErr.status)
						? anyErr.status
						: null;
				if (direct !== null) return direct;
				const fromDetails =
					typeof anyErr?.details?.upstreamStatus === "number" &&
					Number.isFinite(anyErr.details.upstreamStatus)
						? anyErr.details.upstreamStatus
						: null;
				if (fromDetails !== null) return fromDetails;
				const fromUpstreamData =
					anyErr?.details?.upstreamData?.error?.code ??
					anyErr?.details?.upstreamData?.error?.statusCode ??
					anyErr?.details?.upstreamData?.error?.status_code ??
					anyErr?.details?.upstreamData?.status ??
					null;
				const n =
					typeof fromUpstreamData === "number"
						? fromUpstreamData
						: typeof fromUpstreamData === "string" &&
								/^\d+$/.test(fromUpstreamData.trim())
							? Number(fromUpstreamData.trim())
							: null;
				return typeof n === "number" && Number.isFinite(n) ? n : null;
			};

			const isRetryableGenerateContentError = (err: unknown): boolean => {
				const status = resolveUpstreamHttpStatus(err);
				if (typeof status === "number") {
					// Retry on transient upstream errors or gateway failures.
					if (status === 408 || status === 409 || status === 429) return true;
					if (status >= 500 && status <= 599) return true;
				}
				if (!err || typeof err !== "object") return false;
				const anyErr: any = err;
				const msg =
					typeof anyErr.message === "string"
						? anyErr.message.toLowerCase()
						: "";
				if (!msg) return false;
				return (
					msg.includes("timeout") ||
					msg.includes("timed out") ||
					msg.includes("rate limit") ||
					msg.includes("overload") ||
					msg.includes("temporarily") ||
					msg.includes("try again")
				);
			};

			const isTimeoutLikeGenerateContentError = (err: unknown): boolean => {
				if (!err || typeof err !== "object") return false;
				const anyErr: any = err;
				const code = typeof anyErr?.code === "string" ? anyErr.code.toLowerCase() : "";
				if (code.includes("timeout")) return true;
				const msg = typeof anyErr?.message === "string" ? anyErr.message.toLowerCase() : "";
				if (
					msg.includes("timeout") ||
					msg.includes("timed out") ||
					msg.includes("aborted") ||
					msg.includes("operation was aborted")
				) {
					return true;
				}
				return false;
			};

				const extractImagesFromGenerateContent = (
					payload: any,
				): Array<{ mimeType: string; base64: string }> => {
					const collected: { mimeType: string; base64: string }[] = [];
					const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
				for (const cand of candidates) {
					const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
					for (const part of parts) {
						const inline = part?.inlineData || part?.inline_data || null;
						const mimeType =
							typeof inline?.mimeType === "string"
								? inline.mimeType
								: typeof inline?.mime_type === "string"
									? inline.mime_type
									: "";
						const base64 = typeof inline?.data === "string" ? inline.data.trim() : "";
						if (!base64) continue;
						collected.push({
							mimeType: normalizeImageMimeType(mimeType),
							base64,
						});
						if (collected.length >= 4) break;
					}
					if (collected.length >= 4) break;
				}
					return collected;
				};

				const extractImageUrlsFromGenerateContent = (payload: any): string[] => {
					const urls: string[] = [];
					const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];

					const normalizeExtractedUrl = (raw: string): string => {
						let value = String(raw || "").trim();
						if (!value) return value;
						// Providers sometimes escape markdown punctuation inside URLs (e.g. \_).
						value = value.replace(/\\([\\()_])/g, "$1");
						// Strip wrapping quotes/brackets if present.
						value = value.replace(/^<(.+)>$/, "$1").replace(/^['"](.+)['"]$/, "$1");
						return value.trim();
					};

					const looksLikeImageUrl = (raw: string): boolean => {
						const u = String(raw || "").trim();
						if (!u) return false;
						if (/cdn\.qwenlm\.ai\/output\//i.test(u)) return true;
						return /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(u);
					};

					for (const cand of candidates) {
						const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
						for (const part of parts) {
							const text = typeof part?.text === "string" ? part.text.trim() : "";
							if (!text) continue;

							// Markdown image: ![alt](url) / ![](url "title")
							{
								const md = /!\[[^\]]*]\(([^)]+)\)/g;
								for (const match of text.matchAll(md)) {
									const inside = String(match?.[1] || "").trim();
									if (!inside) continue;
									let candidate = inside;
									if (candidate.startsWith("<") && candidate.includes(">")) {
										candidate = candidate.slice(1, candidate.indexOf(">"));
									} else {
										candidate = candidate.split(/\s+/)[0] || "";
									}
									candidate = normalizeExtractedUrl(candidate);
									if (!/^https?:\/\//i.test(candidate)) continue;
									urls.push(candidate);
									if (urls.length >= 4) break;
								}
							}

							// HTML image tag: <img src="...">
							if (urls.length < 4) {
								const img = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
								for (const match of text.matchAll(img)) {
									const src = normalizeExtractedUrl(String(match?.[1] || ""));
									if (!src) continue;
									if (!/^https?:\/\//i.test(src)) continue;
									urls.push(src);
									if (urls.length >= 4) break;
								}
							}

							// Fallback: sometimes providers return a bare URL (or a truncated markdown without ')').
							if (urls.length < 4) {
								const bareUrl = /(https?:\/\/[^\s<>'")\]]+)/gi;
								for (const match of text.matchAll(bareUrl)) {
									const candidate = normalizeExtractedUrl(String(match?.[1] || ""));
									if (!candidate) continue;
									if (!looksLikeImageUrl(candidate)) continue;
									urls.push(candidate);
									if (urls.length >= 4) break;
								}
							}

							if (urls.length >= 4) break;
						}
						if (urls.length >= 4) break;
					}
					return Array.from(new Set(urls));
				};

					type YunwuInputImageForLog = {
						source: string;
						mimeType: string;
						mode: YunwuGenerateContentImageMode;
					};

					const toInlinePart = (
						img: YunwuInlineInputImage,
						style: YunwuGenerateContentPartsStyle,
					): any =>
						style === "camel"
							? {
									inlineData: {
										mimeType: img.mimeType,
										data: img.base64,
									},
								}
							: {
									inline_data: {
										mime_type: img.mimeType,
										data: img.base64,
									},
								};

					const toFilePart = (
						img: YunwuFileInputImage,
						style: YunwuGenerateContentPartsStyle,
					): any =>
						style === "camel"
							? {
									fileData: {
										mimeType: img.mimeType,
										fileUri: img.uri,
									},
								}
							: {
									file_data: {
										mime_type: img.mimeType,
										file_uri: img.uri,
									},
								};

					const prepareInputParts = async (
						style: YunwuGenerateContentPartsStyle,
						imageMode: YunwuGenerateContentImageMode,
					): Promise<{
						parts: any[];
						inputImages: YunwuInputImageForLog[];
						failed: Array<{ source: string; error: string }>;
					}> => {
						const textPart: any = { text: promptText };
						if (!hasAnyInputImages) {
							return { parts: [textPart], inputImages: [], failed: [] };
						}

						if (imageMode === "file") {
							const parts: any[] = [textPart];
							const inputImages: YunwuInputImageForLog[] = [];

							for (const img of inlineImages) {
								parts.push(toInlinePart(img, style));
								inputImages.push({
									source: img.source,
									mimeType: img.mimeType,
									mode: "inline",
								});
							}

							for (const img of fileImages) {
								parts.push(toFilePart(img, style));
								inputImages.push({
									source: img.source,
									mimeType: img.mimeType,
									mode: "file",
								});
							}

							return {
								parts,
								inputImages,
								failed: inputImagesFailedBase,
							};
						}

						const resolved = await resolveInlineImages();
						const parts: any[] = [textPart];
						const inputImages: YunwuInputImageForLog[] = [];
						for (const img of resolved.images) {
							parts.push(toInlinePart(img, style));
							inputImages.push({
								source: img.source,
								mimeType: img.mimeType,
								mode: "inline",
							});
						}
						return { parts, inputImages, failed: resolved.failed };
					};

			const makeGenerationConfig = (
				modalities: YunwuGenerateContentModalities,
				configMode: YunwuGenerateContentConfigMode,
			): Record<string, any> | null => {
				if (configMode === "none") return null;
				const generationConfig: Record<string, any> = {
					responseModalities:
						modalities === "text_image" ? ["TEXT", "IMAGE"] : ["IMAGE"],
				};
				if (configMode === "full" && hasExplicitImageConfig) {
					generationConfig.imageConfig = {
						...(aspectRatio ? { aspectRatio } : {}),
						...(imageSize ? { imageSize } : {}),
						...(imageResolution ? { resolution: imageResolution } : {}),
					};
				}
				return generationConfig;
			};

					type YunwuGenerateContentAttempt = {
						partsStyle: YunwuGenerateContentPartsStyle;
						modalities: YunwuGenerateContentModalities;
						configMode: YunwuGenerateContentConfigMode;
						imageMode: YunwuGenerateContentImageMode;
					};

					const attempts: YunwuGenerateContentAttempt[] = [];
					const preferComflyGeminiShape = ctx.viaProxyVendor === "comfly";

						if (hasAnyInputImages && fileImages.length && !preferComflyGeminiShape) {
							attempts.push(
								...([
								{
									partsStyle: "snake",
									modalities: "image",
									configMode: "full",
									imageMode: "file",
								},
								{
									partsStyle: "snake",
									modalities: "image",
									configMode: "minimal",
									imageMode: "file",
								},
								{
									partsStyle: "snake",
									modalities: "image",
									configMode: "none",
									imageMode: "file",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "full",
									imageMode: "file",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "minimal",
									imageMode: "file",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "none",
									imageMode: "file",
								},
								{
									partsStyle: "camel",
									modalities: "image",
									configMode: "minimal",
									imageMode: "file",
								},
								{
									partsStyle: "camel",
									modalities: "text_image",
									configMode: "minimal",
									imageMode: "file",
								},
							] satisfies YunwuGenerateContentAttempt[]),
						);
						}

						if (hasAnyInputImages) {
							const inlineAttempts = preferComflyGeminiShape
								? ([
										{
											partsStyle: "camel",
											modalities: "image",
											configMode: "full",
											imageMode: "inline",
										},
										{
											partsStyle: "camel",
											modalities: "image",
											configMode: "minimal",
											imageMode: "inline",
										},
										{
											partsStyle: "camel",
											modalities: "image",
											configMode: "none",
											imageMode: "inline",
										},
										{
											partsStyle: "camel",
											modalities: "text_image",
											configMode: "full",
											imageMode: "inline",
										},
										{
											partsStyle: "camel",
											modalities: "text_image",
											configMode: "minimal",
											imageMode: "inline",
										},
										{
											partsStyle: "camel",
											modalities: "text_image",
											configMode: "none",
											imageMode: "inline",
										},
										{
											partsStyle: "snake",
											modalities: "image",
											configMode: "minimal",
											imageMode: "inline",
										},
										{
											partsStyle: "snake",
											modalities: "text_image",
											configMode: "minimal",
											imageMode: "inline",
										},
									] satisfies YunwuGenerateContentAttempt[])
								: ([
									{
										partsStyle: "snake",
										modalities: "image",
									configMode: "full",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "image",
									configMode: "minimal",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "image",
									configMode: "none",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "full",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "minimal",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "none",
									imageMode: "inline",
								},
								{
									partsStyle: "camel",
									modalities: "image",
									configMode: "full",
									imageMode: "inline",
								},
								{
									partsStyle: "camel",
									modalities: "image",
									configMode: "minimal",
									imageMode: "inline",
								},
								{
									partsStyle: "camel",
									modalities: "image",
									configMode: "none",
									imageMode: "inline",
								},
								{
									partsStyle: "camel",
									modalities: "text_image",
									configMode: "full",
									imageMode: "inline",
								},
								{
									partsStyle: "camel",
									modalities: "text_image",
									configMode: "minimal",
									imageMode: "inline",
								},
								{
									partsStyle: "camel",
									modalities: "text_image",
										configMode: "none",
										imageMode: "inline",
									},
								] satisfies YunwuGenerateContentAttempt[]);
							attempts.push(...inlineAttempts);
						} else {
						attempts.push(
							...([
								{
									partsStyle: "snake",
									modalities: "image",
									configMode: "full",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "image",
									configMode: "minimal",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "image",
									configMode: "none",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "full",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "minimal",
									imageMode: "inline",
								},
								{
									partsStyle: "snake",
									modalities: "text_image",
									configMode: "none",
									imageMode: "inline",
								},
							] satisfies YunwuGenerateContentAttempt[]),
						);
					}

				const configuredMaxAttemptsRaw = Number(
					(c.env as any).YUNWU_GENERATE_CONTENT_MAX_ATTEMPTS,
				);
				let maxAttempts =
					Number.isFinite(configuredMaxAttemptsRaw) && configuredMaxAttemptsRaw > 0
						? Math.max(1, Math.min(20, Math.floor(configuredMaxAttemptsRaw)))
						: hasAnyInputImages
							? 12
							: 3;
				// When reference images are present, the attempt list starts with file-mode variants.
				// Keep enough budget to reach inline/camel fallbacks instead of failing early on one style.
				if (hasAnyInputImages && fileImages.length) {
					maxAttempts = Math.max(maxAttempts, 9);
				}
				const configuredRetryableBudgetRaw = Number(
					(c.env as any).YUNWU_GENERATE_CONTENT_RETRYABLE_BUDGET,
				);
				const retryableBudget =
					Number.isFinite(configuredRetryableBudgetRaw) && configuredRetryableBudgetRaw > 0
						? Math.max(1, Math.min(10, Math.floor(configuredRetryableBudgetRaw)))
						: 2;
				const configuredTimeoutRaw = Number(
					(c.env as any).YUNWU_GENERATE_CONTENT_TIMEOUT_MS,
				);
				const callTimeoutMs =
					Number.isFinite(configuredTimeoutRaw) && configuredTimeoutRaw > 0
						? Math.max(5_000, Math.min(600_000, Math.floor(configuredTimeoutRaw)))
						: 600_000;
				const attemptsToRun = attempts.slice(0, maxAttempts);
				const attemptsWithRequiredConfig = hasExplicitImageConfig
					? attemptsToRun.filter((attempt) => attempt.configMode === "full")
					: attemptsToRun;

				let data: any = null;
				let lastErr: any = null;
				let lastAttempt: (typeof attemptsToRun)[number] | null = null;
				let lastAttemptBody: any = null;
				let lastAttemptParts: any[] = [];
				let lastAttemptInputImages: YunwuInputImageForLog[] = [];
				let lastAttemptInputImagesFailed: Array<{ source: string; error: string }> = [];
				const attemptsTried: string[] = [];
				let retryableErrors = 0;
				let timeoutErrors = 0;

				for (let i = 0; i < attemptsWithRequiredConfig.length; i += 1) {
					const attempt = attemptsWithRequiredConfig[i]!;
					lastAttempt = attempt;
					const attemptLabel = `${attempt.partsStyle}:${attempt.configMode}:${attempt.modalities}:${attempt.imageMode}`;
					attemptsTried.push(attemptLabel);

					const prepared = await prepareInputParts(attempt.partsStyle, attempt.imageMode);
					const inputParts = prepared.parts;
					lastAttemptParts = inputParts;
					lastAttemptInputImages = prepared.inputImages;
					lastAttemptInputImagesFailed = prepared.failed;

					const generationConfig = makeGenerationConfig(
						attempt.modalities,
						attempt.configMode,
					);
					const body: any = {
						contents: [{ role: "user", parts: inputParts }],
					};
					if (generationConfig) body.generationConfig = generationConfig;
					lastAttemptBody = body;

					try {
						// eslint-disable-next-line no-await-in-loop
						data = await callJsonApi(
							c,
							url,
							{
								method: "POST",
								headers,
								body: JSON.stringify(body),
							},
							{ provider: v },
							{ timeoutMs: callTimeoutMs },
						);
						lastErr = null;
						const images = extractImagesFromGenerateContent(data);
						const imageUrls = images.length ? [] : extractImageUrlsFromGenerateContent(data);
						if (images.length > 0 || imageUrls.length > 0) break;
						// 2xx but no image parts; try a stricter fallback attempt.
						continue;
					} catch (err) {
						lastErr = err;
						const timeoutLike = isTimeoutLikeGenerateContentError(err);
						if (timeoutLike) timeoutErrors += 1;
						if (isInvalidArgumentError(err)) {
							try {
								const requestId = (() => {
									try {
										const v = (c as any)?.get?.("requestId");
										return typeof v === "string" && v.trim() ? v.trim() : null;
									} catch {
										return null;
									}
								})();
								console.warn(
									JSON.stringify({
										ts: new Date().toISOString(),
										type: "vendor_attempt_trace",
										event: "invalid_argument_retry",
										requestId,
										provider: v,
										model,
										taskKind: req.kind,
										attemptLabel,
										attemptIndex: i + 1,
										attemptsTotal: attemptsWithRequiredConfig.length,
										willRetry: true,
										explicitImageConfig: hasExplicitImageConfig,
										message:
											typeof (err as any)?.message === "string"
												? String((err as any).message).slice(0, 300)
												: String(err).slice(0, 300),
									}),
								);
							} catch {
								// ignore
							}
							continue;
						}
						if (isRetryableGenerateContentError(err)) {
							retryableErrors += 1;
							const willRetry = retryableErrors < retryableBudget;
							try {
								const requestId = (() => {
									try {
										const v = (c as any)?.get?.("requestId");
										return typeof v === "string" && v.trim() ? v.trim() : null;
									} catch {
										return null;
									}
								})();
								console.warn(
									JSON.stringify({
										ts: new Date().toISOString(),
										type: "vendor_attempt_trace",
										event: timeoutLike ? "timeout_retry" : "retryable_error_retry",
										requestId,
										provider: v,
										model,
										taskKind: req.kind,
										attemptLabel,
										attemptIndex: i + 1,
										attemptsTotal: attemptsWithRequiredConfig.length,
										retryableErrors,
										timeoutErrors,
										retryableBudget,
										willRetry,
										explicitImageConfig: hasExplicitImageConfig,
										message:
											typeof (err as any)?.message === "string"
												? String((err as any).message).slice(0, 300)
												: String(err).slice(0, 300),
									}),
								);
							} catch {
								// ignore
							}
							if (willRetry) {
								continue;
							}
							break;
						}
						try {
							const requestId = (() => {
								try {
									const v = (c as any)?.get?.("requestId");
									return typeof v === "string" && v.trim() ? v.trim() : null;
								} catch {
									return null;
								}
							})();
							console.warn(
								JSON.stringify({
									ts: new Date().toISOString(),
									type: "vendor_attempt_trace",
									event: "non_retryable_error_break",
									requestId,
									provider: v,
									model,
									taskKind: req.kind,
									attemptLabel,
									attemptIndex: i + 1,
									attemptsTotal: attemptsWithRequiredConfig.length,
									willRetry: false,
									explicitImageConfig: hasExplicitImageConfig,
									message:
										typeof (err as any)?.message === "string"
											? String((err as any).message).slice(0, 300)
											: String(err).slice(0, 300),
								}),
							);
						} catch {
							// ignore
						}
						break;
					}
				}

				const attemptLabel = lastAttempt
					? `${lastAttempt.partsStyle}:${lastAttempt.configMode}:${lastAttempt.modalities}:${lastAttempt.imageMode}`
					: "unknown";
				const logBody = {
					...(lastAttemptBody || {}),
					contents: [
						{
						role: "user",
						parts: lastAttemptParts.map((p) => redactGeminiInlineData(p)),
					},
				],
					attempt: {
						label: attemptLabel,
						partsStyle: lastAttempt?.partsStyle ?? null,
						configMode: lastAttempt?.configMode ?? null,
						modalities: lastAttempt?.modalities ?? null,
						imageMode: lastAttempt?.imageMode ?? null,
						tried: attemptsTried,
						maxAttempts,
						retryableBudget,
						retryableErrors,
						timeoutErrors,
						timeoutMs: callTimeoutMs,
					},
						...(lastAttemptInputImages.length
							? {
									inputImage: {
										source: lastAttemptInputImages[0]!.source,
										mimeType: lastAttemptInputImages[0]!.mimeType,
										mode: lastAttemptInputImages[0]!.mode,
									},
									inputImages: lastAttemptInputImages.map((img) => ({
										source: img.source,
										mimeType: img.mimeType,
										mode: img.mode,
									})),
									...(lastAttemptInputImagesFailed.length
										? { referenceImagesFailed: lastAttemptInputImagesFailed }
										: {}),
								}
							: {}),
					};

			if (lastErr || !data) {
				const errMsg =
					typeof lastErr?.message === "string" && lastErr.message.trim()
						? lastErr.message.trim()
						: "yunwu generateContent 调用失败";
				await recordVendorCallPayloads(c, {
					userId,
					vendor: v,
					taskId: id,
					taskKind: req.kind,
					request: { url: logUrl, body: logBody },
					upstreamResponse: {
						url: logUrl,
						error: {
							message: errMsg,
							status: typeof lastErr?.status === "number" ? lastErr.status : null,
							code: typeof lastErr?.code === "string" ? lastErr.code : null,
						},
						details: (lastErr as any)?.details ?? null,
					},
				});
				throw lastErr;
			}

			await recordVendorCallPayloads(c, {
				userId,
				vendor: v,
				taskId: id,
				taskKind: req.kind,
				request: { url: logUrl, body: logBody },
				upstreamResponse: {
					url: logUrl,
					data: summarizeGeminiGenerateContentResponse(data),
				},
			});

				const images = extractImagesFromGenerateContent(data);
				const imageUrls = images.length ? [] : extractImageUrlsFromGenerateContent(data);

				const assets = images.length
					? images.map((img) =>
							TaskAssetSchema.parse({
								type: "image",
								url: `data:${img.mimeType};base64,${img.base64}`,
								thumbnailUrl: null,
							}),
						)
					: imageUrls.map((u) =>
							TaskAssetSchema.parse({
								type: "image",
								url: u,
								thumbnailUrl: null,
							}),
						);
				const status: "succeeded" | "failed" = assets.length ? "succeeded" : "failed";

				await bindReservationToTaskId(c, userId, reservation, id);

			return TaskResultSchema.parse({
				id,
				kind: req.kind,
				status,
				assets,
				raw: {
					provider: "gemini_generateContent",
					vendor: v,
					model,
					response: summarizeGeminiGenerateContentResponse(data),
				},
			});
			}

				if (req.kind === "image_edit") {
					if (!referenceImages.length) {
						throw new AppError(
							"image_edit 需要提供 extras.referenceImages（或 image_urls/imageUrls/urls）",
						{
							status: 400,
							code: "reference_images_missing",
							details: {
								vendor: v,
								extrasKeys: Object.keys(extras || {}).sort(),
							},
						},
					);
				}

				{
					let editUrl = buildOpenAIImagesEditsUrlForTask(baseUrl);
					const editLogUrl = editUrl;

					const editHeaders: Record<string, string> = {
						Accept: "application/json",
					};

					if (auth?.authType === "none") {
						// no-op
					} else if (auth?.authType === "query") {
						const param = auth.authQueryParam || "api_key";
						const u = new URL(editUrl);
						u.searchParams.set(param, apiKey);
						editUrl = u.toString();
					} else if (auth?.authType === "x-api-key") {
						const header = auth.authHeader || "X-API-Key";
						editHeaders[header] = apiKey;
					} else {
						const header = auth?.authHeader || "Authorization";
						editHeaders[header] = `Bearer ${apiKey}`;
					}

					const n = (() => {
						const raw =
							typeof extras.variants === "number"
								? extras.variants
								: typeof extras.n === "number"
									? extras.n
									: null;
						if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
						return Math.max(1, Math.min(8, Math.round(raw)));
					})();

					const form = new FormData();
					form.append("model", model);
					form.append("prompt", req.prompt);
					form.append("n", String(n));
					form.append("response_format", "url");

					if (typeof req.width === "number" && typeof req.height === "number") {
						const w = Math.max(1, Math.round(req.width));
						const h = Math.max(1, Math.round(req.height));
						form.append("size", `${w}x${h}`);
					}

					const uploadedRefs: Array<{
						url: string;
						mode: "fetched_file" | "data_url_file";
						contentType: string;
						filename: string;
						bytes: number;
					}> = [];
					const failedRefs: Array<{ url: string; error: string }> = [];

					const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
					const REF_FETCH_TIMEOUT_MS = 25_000;
					const EDIT_REQUEST_TIMEOUT_MS = 600_000;
					const promiseWithTimeout = async <T>(
						promise: Promise<T>,
						timeoutMs: number,
						onTimeout: () => Error,
					): Promise<T> => {
						if (!timeoutMs || timeoutMs <= 0) return promise;
						return await new Promise<T>((resolve, reject) => {
							const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
							(timer as any)?.unref?.();
							promise.then(
								(value) => {
									clearTimeout(timer);
									resolve(value);
								},
								(err) => {
									clearTimeout(timer);
									reject(err);
								},
							);
						});
					};
					const resolveReferenceImageFilePart = async (
						raw: string,
						idx: number,
					): Promise<{ blob: Blob; filename: string; meta: (typeof uploadedRefs)[number] }> => {
						const ref = String(raw || "").trim();
						if (!ref) {
							throw new AppError("参考图为空", {
								status: 400,
								code: "invalid_reference_image",
							});
						}
						if (/^blob:/i.test(ref)) {
							throw new AppError(
								"blob: URL 无法在 Worker 侧下载，请先上传为可访问的图片地址",
								{
									status: 400,
									code: "invalid_reference_image",
								},
							);
						}

						const dataUrlMatch = ref.match(/^data:([^;]+);base64,(.+)$/i);
						if (dataUrlMatch) {
							const mimeType =
								(dataUrlMatch[1] || "").trim() || "application/octet-stream";
							if (!/^image\//i.test(mimeType)) {
								throw new AppError("参考图不是 image/* 内容", {
									status: 400,
									code: "invalid_reference_image",
									details: { contentType: mimeType },
								});
							}
							const base64 = (dataUrlMatch[2] || "").trim();
							const bytes = decodeBase64ToBytes(base64);
							if (bytes.byteLength > MAX_IMAGE_BYTES) {
								throw new AppError("参考图过大，无法上传到上游", {
									status: 400,
									code: "reference_image_too_large",
									details: {
										contentLength: bytes.byteLength,
										maxBytes: MAX_IMAGE_BYTES,
									},
								});
								}
								const ext = detectImageExtensionFromMimeType(mimeType);
								const filename = `input_reference_${idx + 1}.${ext || "bin"}`;
								const blobBytes = new Uint8Array(bytes);
								return {
									blob: new Blob([blobBytes], { type: mimeType }),
									filename,
									meta: {
									url: ref.slice(0, 160),
									mode: "data_url_file",
									contentType: mimeType,
									filename,
									bytes: bytes.byteLength,
								},
							};
						}

						let resolved = ref;
						if (resolved.startsWith("/")) {
							try {
								resolved = new URL(resolved, new URL(c.req.url).origin).toString();
							} catch {
								resolved = ref;
							}
						}

						if (!/^https?:\/\//i.test(resolved)) {
							throw new AppError("参考图必须为 http(s) URL 或 data:image/*;base64", {
								status: 400,
								code: "invalid_reference_image",
								details: { url: ref.slice(0, 160) },
							});
						}

						let res: Response;
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), REF_FETCH_TIMEOUT_MS);
						try {
							res = await fetchWithHttpDebugLog(
								c,
								resolved,
								{
									method: "GET",
									headers: { Accept: "image/*,*/*;q=0.8" },
									signal: controller.signal,
								},
								{ tag: `${v}:images:edits:fetch` },
							);
						} catch (err: any) {
							clearTimeout(timeout);
							const isAbort =
								err?.name === "AbortError" || /aborted|timeout/i.test(err?.message || "");
							throw new AppError(isAbort ? "参考图下载超时" : "参考图下载失败", {
								status: 502,
								code: isAbort
									? "reference_image_fetch_timeout"
									: "reference_image_fetch_failed",
								details: { message: err?.message ?? String(err) },
							});
							} finally {
								clearTimeout(timeout);
							}
							if (!res.ok) {
								throw new AppError(`参考图下载失败: ${res.status}`, {
									status: 502,
									code: "reference_image_fetch_failed",
								details: { upstreamStatus: res.status, url: resolved },
							});
						}

						const contentType =
							(res.headers.get("content-type") || "").split(";")[0]?.trim() ||
							"application/octet-stream";
						if (!/^image\//i.test(contentType)) {
							throw new AppError("参考图不是 image/* 内容", {
								status: 400,
								code: "invalid_reference_image",
								details: { contentType, url: resolved },
							});
						}

						const lenHeader = res.headers.get("content-length");
						const len =
							typeof lenHeader === "string" && /^\d+$/.test(lenHeader)
								? Number(lenHeader)
								: null;
						if (typeof len === "number" && Number.isFinite(len) && len > MAX_IMAGE_BYTES) {
							throw new AppError("参考图过大，无法上传到上游", {
								status: 400,
								code: "reference_image_too_large",
								details: { contentLength: len, maxBytes: MAX_IMAGE_BYTES, url: resolved },
							});
						}

						const buf = await promiseWithTimeout(
							res.arrayBuffer(),
							REF_FETCH_TIMEOUT_MS,
							() => new Error("reference_image_read_timeout"),
						).catch((err: any) => {
							if (String(err?.message || "").includes("reference_image_read_timeout")) {
								try {
									res.body?.cancel();
								} catch {}
								throw new AppError("参考图读取超时", {
									status: 502,
									code: "reference_image_fetch_timeout",
									details: { url: resolved.slice(0, 160) },
								});
							}
							throw err;
						});
						if (buf.byteLength > MAX_IMAGE_BYTES) {
							throw new AppError("参考图过大，无法上传到上游", {
								status: 400,
								code: "reference_image_too_large",
								details: {
									contentLength: buf.byteLength,
									maxBytes: MAX_IMAGE_BYTES,
									url: resolved,
								},
							});
						}

						const extFromUrl = (() => {
							try {
								const pathname = new URL(resolved).pathname || "";
								const m = pathname.match(/\.([a-zA-Z0-9]+)$/);
								return m && m[1] ? m[1].toLowerCase() : null;
							} catch {
								return null;
							}
						})();
						const ext = extFromUrl || detectImageExtensionFromMimeType(contentType);
						const filename = `input_reference_${idx + 1}.${ext || "bin"}`;
						return {
							blob: new Blob([buf], { type: contentType }),
							filename,
							meta: {
								url: resolved.slice(0, 160),
								mode: "fetched_file",
								contentType,
								filename,
								bytes: buf.byteLength,
							},
						};
					};

					const settled = await Promise.allSettled(
						referenceImages
							.slice(0, 4)
							.map((ref, idx) => resolveReferenceImageFilePart(ref, idx)),
					);
					for (const [idx, item] of settled.entries()) {
						const ref = referenceImages[idx] || "";
						if (item.status === "fulfilled") {
							const filePart = item.value;
							form.append("image", filePart.blob, filePart.filename);
							uploadedRefs.push(filePart.meta);
							continue;
						}
						const msg =
							typeof (item.reason as any)?.message === "string"
								? (item.reason as any).message
								: String(item.reason || "unknown error");
						failedRefs.push({ url: ref.slice(0, 160) || `ref_${idx + 1}`, error: msg });
					}

					if (!uploadedRefs.length) {
						throw new AppError("未找到可用的参考图（无法上传到上游）", {
							status: 400,
							code: "reference_images_invalid",
						});
					}

					const editController = new AbortController();
					const editTimeout = setTimeout(
						() => editController.abort(),
						EDIT_REQUEST_TIMEOUT_MS,
					);

					let res: Response;
					let data: any = null;
					try {
						res = await fetchWithHttpDebugLog(
							c,
							editUrl,
							{
								method: "POST",
								headers: editHeaders,
								body: form,
								signal: editController.signal,
							},
							{ tag: `${v}:images:edits` },
						);
						try {
							data = await promiseWithTimeout(
								res.json(),
								EDIT_REQUEST_TIMEOUT_MS,
								() => new Error("image_edit_response_timeout"),
							);
						} catch {
							data = null;
						}
					} catch (err: any) {
						const isAbort =
							err?.name === "AbortError" || /aborted|timeout/i.test(err?.message || "");
						throw new AppError(
							isAbort ? "上游图像编辑请求超时" : `${v} 请求失败`,
							{
								status: 502,
								code: isAbort ? `${v}_request_timeout` : `${v}_request_failed`,
								details: { message: err?.message ?? String(err) },
							},
						);
					} finally {
						clearTimeout(editTimeout);
					}

					if (!res.ok) {
						const msg =
							(data && (data.error?.message || data.message || data.error)) ||
							`${v} 调用失败: ${res.status}`;
						throw new AppError(msg, {
							status: res.status,
							code: `${v}_request_failed`,
							details: { upstreamStatus: res.status, upstreamData: data ?? null },
						});
					}

					const urls = extractBananaImageUrls(data);
					const assets = urls.map((u) =>
						TaskAssetSchema.parse({ type: "image", url: u, thumbnailUrl: null }),
					);
					const upstreamId =
						(typeof data?.id === "string" && data.id.trim()) ||
						(typeof data?.task_id === "string" && data.task_id.trim()) ||
						(typeof data?.taskId === "string" && data.taskId.trim()) ||
						`${v}-img-${Date.now().toString(36)}`;
					const id = forcedTaskId || upstreamId;
					const status: "succeeded" | "failed" = assets.length ? "succeeded" : "failed";

					await recordVendorCallPayloads(c, {
						userId,
						vendor: v,
						taskId: id,
						taskKind: req.kind,
						request: {
							url: editLogUrl,
							body: {
								contentType: "multipart",
								model,
								prompt: req.prompt,
								n,
								referenceImages: uploadedRefs,
								referenceImagesFailed: failedRefs.length ? failedRefs : undefined,
							},
						},
						upstreamResponse: { url: editLogUrl, data },
					});

					await bindReservationToTaskId(c, userId, reservation, id);

					return TaskResultSchema.parse({
						id,
						kind: req.kind,
						status,
						assets,
						raw: {
							provider: "openai_compat",
							vendor: v,
							model,
							response: data,
						},
					});
				}
			}

			let url = buildOpenAIImagesGenerationsUrlForTask(baseUrl);
			const logUrl = url;
			if (auth?.authType === "none") {
				// no-op
		} else if (auth?.authType === "query") {
			const param = auth.authQueryParam || "api_key";
			const u = new URL(url);
			u.searchParams.set(param, apiKey);
			url = u.toString();
		} else if (auth?.authType === "x-api-key") {
			const header = auth.authHeader || "X-API-Key";
			headers[header] = apiKey;
		} else {
			const header = auth?.authHeader || "Authorization";
			headers[header] = `Bearer ${apiKey}`;
		}

		const body: Record<string, any> = {
			model,
			prompt: req.prompt,
		};
		if (typeof req.width === "number" && typeof req.height === "number") {
			const w = Math.max(1, Math.round(req.width));
			const h = Math.max(1, Math.round(req.height));
			body.size = `${w}x${h}`;
		}

		const data = await callJsonApi(
			c,
			url,
			{
				method: "POST",
				headers,
				body: JSON.stringify(body),
			},
			{ provider: v },
		);

		const urls = extractBananaImageUrls(data);
		const assets = urls.map((u) =>
			TaskAssetSchema.parse({ type: "image", url: u, thumbnailUrl: null }),
		);
		const upstreamId =
			(typeof data?.id === "string" && data.id.trim()) ||
			(typeof data?.task_id === "string" && data.task_id.trim()) ||
			(typeof data?.taskId === "string" && data.taskId.trim()) ||
			`${v}-img-${Date.now().toString(36)}`;
		const id = forcedTaskId || upstreamId;
		const status: "succeeded" | "failed" = assets.length ? "succeeded" : "failed";

		await recordVendorCallPayloads(c, {
			userId,
			vendor: v,
			taskId: id,
			taskKind: req.kind,
			request: { url: logUrl, body },
			upstreamResponse: { url: logUrl, data },
		});

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status,
			assets,
			raw: {
				provider: "openai_compat",
				vendor: v,
				model,
				response: data,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

async function runOpenAiCompatibleVideoTaskForVendor(
	c: AppContext,
	userId: string,
	vendorKey: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	const v = normalizeVendorKey(vendorKey);
	const ctx = await resolveVendorContext(c, userId, v);
	const baseUrl = normalizeBaseUrl(ctx.baseUrl);
	const apiKey = (ctx.apiKey || "").trim();
	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}
	if (!apiKey) {
		throw new AppError(`No API key configured for vendor ${v}`, {
			status: 400,
			code: "api_key_missing",
		});
	}

	const explicitModelKey = pickModelKey(req, { modelKey: undefined });
	const modelKeyRaw =
		explicitModelKey ||
		(await resolveDefaultModelKeyFromCatalogForVendor(c, v, "video"));
	const model = modelKeyRaw?.startsWith("models/") ? modelKeyRaw.slice(7) : modelKeyRaw;
	if (!model) {
		throw new AppError(
			"未配置可用的模型（请在 /stats -> 模型管理（系统级）为该厂商添加并启用 video 模型，或在请求里传 extras.modelKey）",
			{
				status: 400,
				code: "model_not_configured",
				details: { vendor: v, taskKind: req.kind },
			},
		);
	}

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: v,
		modelKey: model,
	});

	try {
		const messages: OpenAIChatMessageForTask[] = [{ role: "user", content: req.prompt }];

		const auth = await resolveModelCatalogVendorAuthForTask(c, v);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		let url = buildOpenAIChatCompletionsUrlForTask(baseUrl);
		if (auth?.authType === "none") {
			// no-op
		} else if (auth?.authType === "query") {
			const param = auth.authQueryParam || "api_key";
			const u = new URL(url);
			u.searchParams.set(param, apiKey);
			url = u.toString();
		} else if (auth?.authType === "x-api-key") {
			const header = auth.authHeader || "X-API-Key";
			headers[header] = apiKey;
		} else {
			const header = auth?.authHeader || "Authorization";
			headers[header] = `Bearer ${apiKey}`;
		}

		const body: any = {
			model,
			messages,
			stream: false,
		};

		const data = await callJsonApi(
			c,
			url,
			{
				method: "POST",
				headers,
				body: JSON.stringify(body),
			},
			{ provider: v },
		);

		const urls = (() => {
			const collected = new Set<string>();

			const appendFromText = (value: any) => {
				if (!value) return;
				if (typeof value === "string") {
					extractHtmlVideoUrlsFromText(value).forEach((u) => collected.add(u));
					extractMarkdownLinkUrlsFromText(value)
						.filter(looksLikeVideoUrl)
						.forEach((u) => collected.add(u));
					return;
				}
				if (Array.isArray(value)) {
					value.forEach((part) => {
						if (!part) return;
						if (typeof part === "string") {
							extractHtmlVideoUrlsFromText(part).forEach((u) => collected.add(u));
							extractMarkdownLinkUrlsFromText(part)
								.filter(looksLikeVideoUrl)
								.forEach((u) => collected.add(u));
							return;
						}
						if (typeof part === "object" && typeof (part as any).text === "string") {
							const text = (part as any).text;
							extractHtmlVideoUrlsFromText(text).forEach((u) => collected.add(u));
							extractMarkdownLinkUrlsFromText(text)
								.filter(looksLikeVideoUrl)
								.forEach((u) => collected.add(u));
						}
					});
				}
			};

			appendFromText((data as any)?.content);
			if (Array.isArray((data as any)?.choices)) {
				for (const choice of (data as any).choices) {
					appendFromText(choice?.message?.content);
					appendFromText(choice?.delta?.content);
					appendFromText(choice?.content);
				}
			}
			appendFromText(extractTextFromOpenAIResponseForTask(data));

			return Array.from(collected);
		})();

		const assets = urls.map((u) =>
			TaskAssetSchema.parse({ type: "video", url: u, thumbnailUrl: null }),
		);
		const id =
			(typeof data?.id === "string" && data.id.trim()) ||
			(typeof (data as any)?.task_id === "string" && (data as any).task_id.trim()) ||
			(typeof (data as any)?.taskId === "string" && (data as any).taskId.trim()) ||
			`${v}-vid-${Date.now().toString(36)}`;
		if (!assets.length) {
			const text = extractTextFromOpenAIResponseForTask(data) || "";
			const asyncdata = extractAsyncDataTaskRefFromText(text);
			if (asyncdata) {
				const progress = extractProgressPercentFromText(text);
				const status: "queued" | "running" =
					typeof progress === "number" && progress > 0 ? "running" : "queued";

				const vendorForRef = `${v}:asyncdata`;
				const chatCompletionId = id;
				const createdTaskId = asyncdata.id;
				await upsertVendorTaskRefWithWarn(c, {
					userId,
					kind: "video",
					taskId: createdTaskId,
					vendor: vendorForRef,
					warnTag: "upsert asyncdata video ref failed",
				});
				await upsertVendorTaskRefWithWarn(c, {
					userId,
					kind: "video",
					taskId: chatCompletionId,
					vendor: vendorForRef,
					pid: createdTaskId,
					warnTag: "upsert asyncdata video ref failed",
				});

				await bindReservationToTaskId(c, userId, reservation, createdTaskId);

				return TaskResultSchema.parse({
					id: createdTaskId,
					kind: req.kind,
					status,
					assets: [],
					raw: {
						provider: "openai_compat",
						vendor: v,
						model,
						chatCompletionId,
						response: data,
						asyncdata: {
							id: createdTaskId,
							webUrl: asyncdata.webUrl,
							sourceUrl: asyncdata.sourceUrl,
							progress,
						},
					},
				});
			}
		}

		const status: "succeeded" | "failed" = assets.length ? "succeeded" : "failed";

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status,
			assets,
			raw: {
				provider: "openai_compat",
				vendor: v,
				model,
				response: data,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
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
	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "openai",
		modelKey: model,
	});

	try {
		const extras = (req.extras || {}) as Record<string, any>;

		const systemPrompt =
			req.kind === "prompt_refine"
				? pickSystemPrompt(
						req,
						"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
					)
				: pickSystemPrompt(req, "请用中文回答。");

		const temperature = normalizeTemperature(extras.temperature, 0.7);

		const messages: OpenAIChatMessageForTask[] = [];
		if (systemPrompt) {
			messages.push({ role: "system", content: systemPrompt });
		}

		const referenceImages = (() => {
			const raw = Array.isArray(extras.referenceImages) ? extras.referenceImages : [];
			const out: string[] = [];
			const seen = new Set<string>();
			for (const item of raw) {
				if (typeof item !== "string") continue;
				const trimmed = item.trim();
				if (!trimmed) continue;
				if (!/^https?:\/\//i.test(trimmed)) continue;
				if (trimmed.length > 2048) continue;
				if (seen.has(trimmed)) continue;
				seen.add(trimmed);
				out.push(trimmed);
				if (out.length >= 3) break;
			}
			return out;
		})();

		const userContent: string | OpenAIContentPartForTask[] = referenceImages.length
			? ([
					{ type: "text", text: req.prompt },
					...referenceImages.map(
						(url): OpenAIContentPartForTask => ({
							type: "image_url",
							image_url: { url },
						}),
					),
				] as OpenAIContentPartForTask[])
			: req.prompt;

		messages.push({ role: "user", content: userContent });

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

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status: "succeeded",
			assets: [],
			raw: {
				provider: "openai",
				model,
				response: parsed,
				rawBody,
				text,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
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
	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "openai",
		modelKey: model,
	});

	try {
		const userPrompt =
			req.prompt?.trim() ||
			"Describe this image in rich detail and output a single, well-structured English prompt that can be used to recreate it. Do not add any explanations, headings, markdown formatting, or non-English text.";

		const systemPrompt = pickSystemPrompt(
			req,
			"You are an expert visual analyst. You must follow the user's instruction strictly and return output in exactly the format the user requests. If the user asks for JSON, return valid JSON only (no markdown, no extra text).",
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

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: "image_to_prompt",
			status: "succeeded",
			assets: [],
			raw: {
				provider: "openai",
				model,
				response: parsed,
				rawBody,
				text,
				imageSource,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
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

	const base = normalizeGeminiBaseUrl(ctx.baseUrl);
	const modelKey =
		pickModelKey(req, { modelKey: undefined }) || "models/gemini-2.5-flash";
	const model = modelKey.startsWith("models/")
		? modelKey
		: `models/${modelKey}`;
	const modelId = model.startsWith("models/") ? model.slice(7) : model;
	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: modelId,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "gemini",
		modelKey: modelId,
	});

	try {
		const systemPrompt =
			req.kind === "prompt_refine"
				? pickSystemPrompt(
						req,
						"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
					)
				: pickSystemPrompt(req, "请用中文回答。");

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
	const vendorForLog = (() => {
		const raw = (modelId || "").trim();
		if (!raw) return "gemini";
		return raw.toLowerCase().startsWith("gemini-") ? raw : `gemini-${raw}`;
	})();

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status: "succeeded",
			assets: [],
			raw: {
			provider: "gemini",
			vendor: vendorForLog,
			model: modelId,
			response: data,
			text,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

async function runGeminiImageToPromptTask(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
): Promise<TaskResult> {
	if (req.kind !== "image_to_prompt") {
		throw new AppError("Gemini 仅支持 image_to_prompt", {
			status: 400,
			code: "unsupported_task_kind",
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

	const ctx = await resolveVendorContext(c, userId, "gemini");
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 Gemini API Key", {
			status: 400,
			code: "gemini_api_key_missing",
		});
	}

	const base = normalizeGeminiBaseUrl(ctx.baseUrl);

	const modelKey =
		pickModelKey(req, { modelKey: undefined }) ||
		(await resolveDefaultModelKeyFromCatalogForVendor(c, "gemini", "text")) ||
		"models/gemini-2.5-flash";
	const model = modelKey.startsWith("models/") ? modelKey : `models/${modelKey}`;
	const modelId = model.startsWith("models/") ? model.slice(7) : model;

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: modelId,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "gemini",
		modelKey: modelId,
	});

	try {
		const systemPrompt = pickSystemPrompt(req, "请用中文回答。");
		const temperature = normalizeTemperature(extras.temperature, 0.2);

		const dataUrl = await resolveSora2ApiImageUrl(c, imageData || imageUrl!);
		const match = String(dataUrl || "")
			.trim()
			.match(/^data:([^;]+);base64,(.+)$/i);
		if (!match) {
			throw new AppError("参考图无法解析为 data:image/*;base64", {
				status: 400,
				code: "invalid_image_data",
				details: { imageUrl: imageUrl || null },
			});
		}
		const mimeType = String(match[1] || "").trim() || "application/octet-stream";
		const base64 = String(match[2] || "").replace(/\s+/g, "");
		if (!/^image\//i.test(mimeType) || !base64) {
			throw new AppError("参考图无法解析为有效的 image/* base64", {
				status: 400,
				code: "invalid_image_data",
				details: { mimeType, imageUrl: imageUrl || null },
			});
		}

		const contents: any[] = [];
		if (systemPrompt) {
			contents.push({ role: "user", parts: [{ text: systemPrompt }] });
		}
		contents.push({
			role: "user",
			parts: [
				{ inlineData: { mimeType, data: base64 } },
				{ text: req.prompt },
			],
		});

		const body: any = {
			contents,
			...(typeof extras.temperature === "number" ? { generationConfig: { temperature } } : {}),
		};

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
				body: JSON.stringify(body),
			},
			{ provider: "gemini" },
		);

		const firstCandidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
		const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : [];
		const rawText = parts
			.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
			.join("")
			.trim();
		const text = normalizeImagePromptOutputForTask(rawText);

		const id = `gemini-img2prompt-${Date.now().toString(36)}`;

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: "image_to_prompt",
			status: "succeeded",
			assets: [],
			raw: {
				provider: "gemini",
				vendor: "gemini",
				model: modelId,
				response: data,
				text,
				imageUrl: imageUrl || null,
				imageDataLength: imageData ? imageData.length : 0,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
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
	const raw = trimmed.startsWith("models/") ? trimmed.slice(7) : trimmed;
	const normalized = raw.trim().toLowerCase();
	if (!normalized) return null;
	// Backward compatibility: "nanobanana-fast" -> "nano-banana-fast"
	if (normalized === "nanobanana") return "nano-banana";
	if (normalized.startsWith("nanobanana-")) {
		return `nano-banana-${normalized.slice("nanobanana-".length)}`;
	}
	return normalized;
}

function mapBananaModelToApimartModelKey(model: string): string {
	const m = (model || "").trim().toLowerCase();
	if (m === "nano-banana-pro") return "gemini-3-pro-image-preview";
	return "gemini-2.5-flash-image-preview";
}

	function extractBananaImageUrls(payload: any): string[] {
		if (!payload || typeof payload !== "object") return [];
		const urls = new Set<string>();

		const cleanBase64 = (value: string): string => String(value || "").replace(/\s+/g, "");

		const inferMimeTypeFromBase64 = (value: string): string => {
			const cleaned = cleanBase64(value);
			if (cleaned.startsWith("/9j/")) return "image/jpeg";
			if (cleaned.startsWith("iVBORw0KGgo")) return "image/png";
			if (cleaned.startsWith("R0lGOD")) return "image/gif";
			if (cleaned.startsWith("UklGR")) return "image/webp";
			if (cleaned.startsWith("Qk0")) return "image/bmp";
			if (cleaned.startsWith("AAABAA")) return "image/x-icon";
			return "image/png";
		};

		const looksLikeImageBase64 = (value: string): boolean => {
			const cleaned = cleanBase64(value);
			if (cleaned.length < 256) return false;
			if (!/^[A-Za-z0-9+/_-]+=*$/.test(cleaned)) return false;
			return (
				cleaned.startsWith("/9j/") ||
				cleaned.startsWith("iVBORw0KGgo") ||
				cleaned.startsWith("R0lGOD") ||
				cleaned.startsWith("UklGR") ||
				cleaned.startsWith("Qk0") ||
				cleaned.startsWith("AAABAA")
			);
		};

		const normalizeCandidate = (value: unknown): string | null => {
			if (typeof value !== "string") return null;
			const trimmed = value.trim();
			if (!trimmed) return null;
			if (/^data:[^;]+;base64,/i.test(trimmed)) return trimmed;
			if (looksLikeImageBase64(trimmed)) {
				const cleaned = cleanBase64(trimmed);
				const mimeType = inferMimeTypeFromBase64(cleaned);
				return `data:${mimeType};base64,${cleaned}`;
			}
			return trimmed;
		};

		const toDataUrlFromBase64 = (value: unknown): string | null => {
			if (typeof value !== "string") return null;
			const cleaned = cleanBase64(value);
			if (!cleaned) return null;
			const mimeType = inferMimeTypeFromBase64(cleaned);
			return `data:${mimeType};base64,${cleaned}`;
		};

		const enqueue = (value: any) => {
			if (!value) return;
			const arr = Array.isArray(value) ? value : [value];
			for (const item of arr) {
				const candidate = (() => {
					if (!item) return null;
					if (typeof item === "string") return normalizeCandidate(item);
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
						const normalized = normalizeCandidate((item as any)[key]);
						if (normalized) return normalized;
					}

					const base64Keys = ["base64", "b64_json", "image_base64"];
					for (const key of base64Keys) {
						const normalized = toDataUrlFromBase64((item as any)[key]);
						if (normalized) return normalized;
					}
					return null;
				})();
				if (candidate) {
					urls.add(candidate);
				}
			}
		};

		const candidates = [
			// OpenAI/DALL·E-compatible shapes: { data: [{ url | b64_json }] }
			payload?.data,
			payload?.data?.data,
			payload?.results,
			payload?.images,
			payload?.imageUrls,
			payload?.image_urls,
			payload?.image_paths,
			payload?.outputs,
			payload?.output?.data,
			payload?.output?.data?.data,
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
			const normalized = normalizeCandidate(value);
			if (normalized) urls.add(normalized);
		});

		return Array.from(urls);
	}

// runGeminiBananaImageTask removed: unused dead path.

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
	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "qwen",
		modelKey: model,
	});

	try {
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

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: "text_to_image",
			status,
			assets,
			raw: {
				provider: "qwen",
				model,
				response: data,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
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
	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "sora2api",
		modelKey: model,
	});

	try {
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
	const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
	try {
		res = await fetchWithHttpDebugLog(
			c,
			url,
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
	const vendorForLog = ctx.viaProxyVendor === "grsai" ? "grsai" : "sora2api";
	await recordVendorCallPayloads(c, {
		userId,
		vendor: vendorForLog,
		taskId: id,
		taskKind: req.kind,
		request: { url, body },
		upstreamResponse: { status: res.status, contentType: ct, parsedBody: payload, rawBody: rawText },
	});

	emitProgress(userId, progressCtx, {
		status: status === "succeeded" ? "succeeded" : "failed",
		progress: 100,
		assets,
		raw: { response: payload },
	});

		await bindReservationToTaskId(c, userId, reservation, id);
		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status,
			assets,
			raw: {
				provider: "sora2api",
				vendor: vendorForLog,
				model,
				response: payload,
				rawBody: rawText,
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
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

		const firstFrameUrl = (() => {
			const candidates = [extras.firstFrameUrl, (extras as any).url, (extras as any).imageUrl];
			for (const candidate of candidates) {
				if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
			}
			return undefined;
		})();
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
	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		modelKey: model,
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: "anthropic",
		modelKey: model,
	});

	try {
		const systemPrompt =
			req.kind === "prompt_refine"
				? pickSystemPrompt(
						req,
						"你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。",
					)
				: pickSystemPrompt(req, "请用中文回答。");

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

		await bindReservationToTaskId(c, userId, reservation, id);

		return TaskResultSchema.parse({
			id,
			kind: req.kind,
			status: "succeeded",
			assets: [],
			raw: {
			provider: "anthropic",
			model,
			response: data,
			text: text || "Anthropic 调用成功",
			},
		});
	} catch (err) {
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

async function runMappedTaskForVendorIfConfigured(
	c: AppContext,
	userId: string,
	vendorKey: string,
	req: TaskRequestDto,
	options?: { forceTaskId?: string | null },
): Promise<TaskResult | null> {
	const v = normalizeVendorKey(vendorKey);
	const forcedTaskId =
		typeof options?.forceTaskId === "string" && options.forceTaskId.trim()
			? options.forceTaskId.trim()
			: "";

	const resolveMapping = async (
		taskKind: TaskRequestDto["kind"],
		normalizedExtras: Record<string, unknown>,
	) => {
		const selectionOptions = {
			stage: "create" as const,
			req: {
				...req,
				extras: normalizedExtras,
			},
			modelKey:
				typeof normalizedExtras.modelKey === "string" && normalizedExtras.modelKey.trim()
					? normalizedExtras.modelKey.trim()
					: null,
		};
		const hasVideoReferenceInputs = (() => {
			if (taskKind !== "text_to_video" && taskKind !== "image_to_video") return false;
			const firstFrameUrl =
				typeof normalizedExtras.firstFrameUrl === "string"
					? normalizedExtras.firstFrameUrl.trim()
					: "";
			const lastFrameUrl =
				typeof normalizedExtras.lastFrameUrl === "string"
					? normalizedExtras.lastFrameUrl.trim()
					: "";
			if (firstFrameUrl || lastFrameUrl) return true;
			return collectReferenceImageCandidates(normalizedExtras).length > 0;
		})();

		if (taskKind === "text_to_video" && hasVideoReferenceInputs) {
			const preferred = await resolveEnabledModelCatalogMappingForTask(
				c,
				v,
				"image_to_video",
				selectionOptions,
			);
			if (preferred) return preferred;
		}
		const direct = await resolveEnabledModelCatalogMappingForTask(
			c,
			v,
			taskKind,
			selectionOptions,
		);
		if (direct) return direct;
		if (taskKind === "text_to_video") {
			return await resolveEnabledModelCatalogMappingForTask(
				c,
				v,
				"image_to_video",
				selectionOptions,
			);
		}
		if (taskKind === "image_to_video") {
			return await resolveEnabledModelCatalogMappingForTask(
				c,
				v,
				"text_to_video",
				selectionOptions,
			);
		}
		if (taskKind === "text_to_image") {
			return await resolveEnabledModelCatalogMappingForTask(
				c,
				v,
				"image_edit",
				selectionOptions,
			);
		}
		if (taskKind === "image_edit") {
			return await resolveEnabledModelCatalogMappingForTask(
				c,
				v,
				"text_to_image",
				selectionOptions,
			);
		}
		return null;
	};

	const extras = (req.extras || {}) as Record<string, any>;
	const normalizedExtras: Record<string, any> = { ...extras };

	const collectReferenceImageCandidates = (input: Record<string, any>): string[] => {
		const refs: string[] = [];
		const pushAll = (value: any) => {
			const items = Array.isArray(value) ? value : [value];
			for (const item of items) {
				if (typeof item === "string" && item.trim()) refs.push(item.trim());
			}
		};
		pushAll(input.referenceImages);
		pushAll((input as any).reference_images);
		pushAll((input as any).image_urls);
		pushAll((input as any).imageUrls);
		pushAll((input as any).urls);
		pushAll((input as any).image);
		pushAll((input as any).url);
		return Array.from(new Set(refs));
	};

	const ensureReferenceInlineDataForMappedImageEdit = async () => {
		const hasInlineData =
			normalizedExtras.referenceImageInlineData &&
			typeof normalizedExtras.referenceImageInlineData === "object" &&
			typeof normalizedExtras.referenceImageInlineData.data === "string" &&
			String(normalizedExtras.referenceImageInlineData.data).trim().length > 0;

		if (hasInlineData) return;
		const refs = collectReferenceImageCandidates(normalizedExtras);
		if (!refs.length) return;

		try {
			const dataUrl = await resolveSora2ApiImageUrl(c, refs[0]!);
			const match = String(dataUrl || "")
				.trim()
				.match(/^data:([^;]+);base64,(.+)$/i);
			if (!match) return;
			const mimeType = String(match[1] || "").trim() || "image/jpeg";
			const data = String(match[2] || "").replace(/\s+/g, "");
			if (!data) return;
			normalizedExtras.referenceImageInlineData = {
				mimeType,
				data,
			};
		} catch {
			// fallback: keep raw URL fields for mappings that consume URL directly
		}
	};

	if (req.kind === "text_to_video" || req.kind === "image_to_video") {
		const referenceCandidates = collectReferenceImageCandidates(normalizedExtras);
		if (
			referenceCandidates.length &&
			(!Array.isArray(normalizedExtras.urls) || normalizedExtras.urls.length === 0)
		) {
			normalizedExtras.urls = referenceCandidates;
		}
		if (
			typeof normalizedExtras.firstFrameUrl !== "string" ||
			!normalizedExtras.firstFrameUrl.trim()
		) {
			const url =
				(typeof normalizedExtras.url === "string" && normalizedExtras.url.trim()) ||
				(Array.isArray(normalizedExtras.urls) && normalizedExtras.urls[0]
					? String(normalizedExtras.urls[0]).trim()
					: "") ||
				(referenceCandidates[0] ? referenceCandidates[0] : "") ||
				"";
			if (url) normalizedExtras.firstFrameUrl = url;
		}
	}

	if (req.kind === "chat" || req.kind === "prompt_refine") {
		const fileUriRaw =
			(typeof (normalizedExtras as any).videoFileUri === "string" &&
				String((normalizedExtras as any).videoFileUri).trim()) ||
			(typeof (normalizedExtras as any).fileUri === "string" &&
				String((normalizedExtras as any).fileUri).trim()) ||
			"";
		if (fileUriRaw) {
			const mimeTypeRaw =
				(typeof (normalizedExtras as any).videoMimeType === "string" &&
					String((normalizedExtras as any).videoMimeType).trim()) ||
				(typeof (normalizedExtras as any).mimeType === "string" &&
					String((normalizedExtras as any).mimeType).trim()) ||
				"video/mp4";
			normalizedExtras.videoFilePart = {
				file_data: {
					mime_type: mimeTypeRaw,
					file_uri: fileUriRaw,
				},
			};
		}
	}

	if (req.kind === "image_edit") {
		await ensureReferenceInlineDataForMappedImageEdit();
	}

	if (
		typeof normalizedExtras.modelKey !== "string" ||
		!normalizedExtras.modelKey.trim()
	) {
		const kindHint =
			req.kind === "text_to_video" || req.kind === "image_to_video"
				? "video"
				: req.kind === "text_to_image" || req.kind === "image_edit"
					? "image"
					: req.kind === "chat" || req.kind === "prompt_refine"
						? "text"
					: null;
		if (kindHint) {
			const fallback = await resolveDefaultModelKeyFromCatalogForVendor(c, v, kindHint);
			if (fallback) normalizedExtras.modelKey = fallback;
		}
	}

	if (req.kind === "chat" || req.kind === "prompt_refine") {
		const isLikelyNonTextModelKey = (value: string): boolean =>
			/(^|[-_/])(image|video|veo|nano-banana|imagen)([-_/]|$)/i.test(value);

		const currentModelKey =
			typeof normalizedExtras.modelKey === "string" && normalizedExtras.modelKey.trim()
				? normalizedExtras.modelKey.trim()
				: "";
		const looksLikeNonTextModel = !!currentModelKey && isLikelyNonTextModelKey(currentModelKey);

		if (!currentModelKey || looksLikeNonTextModel) {
			const textFallback = await resolveDefaultModelKeyFromCatalogForVendor(c, v, "text");
			if (textFallback) {
				normalizedExtras.modelKey = textFallback;
			} else if (looksLikeNonTextModel || !currentModelKey) {
				throw new AppError(
					`当前任务为 ${req.kind}，但传入了非文本模型：${currentModelKey || "(empty)"}。请配置并改用 text 模型（如 gemini-3-flash-preview）。`,
					{
						status: 400,
						code: "model_kind_mismatch",
						details: { vendor: v, taskKind: req.kind, modelKey: currentModelKey },
					},
				);
			}
		}
	}

	const mappedModelKey =
		typeof normalizedExtras.modelKey === "string" && normalizedExtras.modelKey.trim()
			? normalizedExtras.modelKey.trim()
			: null;
	const billingSpecKey = extractBillingSpecKeyFromTaskRequest({
		...req,
		extras: normalizedExtras,
	});

	if (req.kind === "chat" || req.kind === "prompt_refine") {
		if (!mappedModelKey) {
			throw new AppError("chat/prompt_refine 任务未配置可用的 text 模型（extras.modelKey 为空）", {
				status: 400,
				code: "model_not_configured",
				details: { vendor: v, taskKind: req.kind },
			});
		}
		if (/(^|[-_/])(image|video|veo|nano-banana|imagen)([-_/]|$)/i.test(mappedModelKey)) {
			throw new AppError(
				`当前任务为 ${req.kind}，但最终模型仍为非文本模型：${mappedModelKey}。请改用 text 模型（如 gemini-3-flash-preview）。`,
				{
					status: 400,
					code: "model_kind_mismatch",
					details: { vendor: v, taskKind: req.kind, modelKey: mappedModelKey },
				},
			);
		}
	}

	const mapping = await resolveMapping(req.kind, normalizedExtras);
	if (!mapping) return null;

	const required = await resolveTeamCreditsCostForTask(c, {
		taskKind: req.kind,
		...(mappedModelKey ? { modelKey: mappedModelKey } : {}),
		...(billingSpecKey ? { specKey: billingSpecKey } : {}),
	});
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required,
		taskKind: req.kind,
		vendor: v,
		modelKey: mappedModelKey,
		specKey: billingSpecKey,
	});

	const requestForMapping: TaskRequestDto = {
		...req,
		extras: normalizedExtras,
	};

	try {
		const ctx = await resolveVendorContext(c, userId, v);
		const baseUrl = normalizeBaseUrl(ctx.baseUrl);
		const apiKey = (ctx.apiKey || "").trim();
		if (!baseUrl) {
			throw new AppError(`No base URL configured for vendor ${v}`, {
				status: 400,
				code: "base_url_missing",
			});
		}
		const auth = await resolveModelCatalogVendorAuthForTask(c, v);

		setTraceStage(c, "task:mapping:create:begin", {
			vendor: v,
			taskKind: req.kind,
			mappingId: mapping.id,
		});

		const upstream = await buildMappedUpstreamRequest({
			c,
			baseUrl,
			apiKey,
			auth,
			stage: "create",
			requestMapping: mapping.requestMapping,
			req: requestForMapping,
			taskId: forcedTaskId || null,
		});
		if (forcedTaskId) {
			await recordVendorCallPayloads(c, {
				userId,
				vendor: v,
				taskId: forcedTaskId,
				taskKind: req.kind,
				request: upstream.requestLog,
			});
		}
		const mappedCreateTimeoutRaw = Number(
			(c.env as any).MAPPED_TASK_CREATE_TIMEOUT_MS ??
				process?.env?.MAPPED_TASK_CREATE_TIMEOUT_MS,
		);
			const mappedCreateTimeoutMs =
				Number.isFinite(mappedCreateTimeoutRaw) && mappedCreateTimeoutRaw > 0
					? Math.max(5_000, Math.min(600_000, Math.floor(mappedCreateTimeoutRaw)))
					: 600_000;

		const payload = await callJsonApi(
			c,
			upstream.url,
			upstream.init,
			{ provider: v, requestPayload: upstream.requestLog },
			{ timeoutMs: mappedCreateTimeoutMs },
		);

		const parsed = parseMappedTaskResultFromPayload({
			vendorKey: v,
			model: mappedModelKey,
			stage: "create",
			reqKind: req.kind,
			payload,
			responseMapping: mapping.responseMapping,
			fallbackTaskId: forcedTaskId || null,
			selectedStageMapping: upstream.selectedStageMapping,
		});
		await recordVendorCallPayloads(c, {
			userId,
			vendor: v,
			taskId: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : forcedTaskId || `mapping-create-${Date.now().toString(36)}`,
			taskKind: req.kind,
			request: upstream.requestLog,
			upstreamResponse: { url: upstream.url, data: payload },
		});
		const billedResult = attachBillingSpecKeyToTaskResult(parsed, billingSpecKey);

		await bindReservationToTaskId(c, userId, reservation, billedResult.id);

		const refKind =
			req.kind === "text_to_video" || req.kind === "image_to_video"
				? ("video" as const)
				: req.kind === "text_to_image" || req.kind === "image_edit"
					? ("image" as const)
					: null;
		if (refKind) {
			const rawRecord =
				billedResult.raw && typeof billedResult.raw === "object" && !Array.isArray(billedResult.raw)
					? (billedResult.raw as Record<string, unknown>)
					: null;
			const pid =
				rawRecord && typeof rawRecord.pid === "string" && rawRecord.pid.trim()
					? rawRecord.pid.trim()
					: null;
			await upsertVendorTaskRefWithWarn(c, {
				userId,
				kind: refKind,
				taskId: billedResult.id,
				vendor: v,
				...(pid ? { pid } : {}),
				warnTag: "upsert mapped task ref failed",
			});
		}

		setTraceStage(c, "task:mapping:create:done", {
			vendor: v,
			taskKind: req.kind,
			taskId: billedResult.id,
			status: billedResult.status,
		});

		return TaskResultSchema.parse({
			...billedResult,
			raw: {
				...(billedResult.raw as any),
				mappingId: mapping.id,
				mappingName: mapping.name,
			},
		});
	} catch (err) {
		if (forcedTaskId) {
			const appErr = err as {
				message?: string;
				code?: string;
				details?: unknown;
			};
			try {
				const ctx = await resolveVendorContext(c, userId, v);
				const baseUrl = normalizeBaseUrl(ctx.baseUrl);
				const apiKey = (ctx.apiKey || "").trim();
				if (baseUrl) {
					const auth = await resolveModelCatalogVendorAuthForTask(c, v);
					const upstream = await buildMappedUpstreamRequest({
						c,
						baseUrl,
						apiKey,
						auth,
						stage: "create",
						requestMapping: mapping.requestMapping,
						req: requestForMapping,
						taskId: forcedTaskId || null,
					});
					await recordVendorCallPayloads(c, {
						userId,
						vendor: v,
						taskId: forcedTaskId,
						taskKind: req.kind,
						request: upstream.requestLog,
						upstreamResponse: {
							error: appErr?.message ?? String(err),
							code:
								typeof appErr?.code === "string" && appErr.code.trim()
									? appErr.code.trim()
									: null,
							details:
								typeof appErr?.details === "undefined"
									? null
									: appErr.details,
						},
					});
				}
			} catch {
				// ignore request log failures on error path
			}
		}
		return await releaseReservationOnThrow(c, userId, reservation, err);
	}
}

async function runGeminiTaskWithRouting(
	c: AppContext,
	userId: string,
	req: TaskRequestDto,
	input: {
		runMapped: () => Promise<TaskResult | null>;
		runMappedOr: (fallback: () => Promise<TaskResult>) => Promise<TaskResult>;
		requireMapped: (capabilityLabel: "图像" | "视频") => Promise<TaskResult>;
	},
): Promise<TaskResult> {
	if (req.kind === "text_to_image" || req.kind === "image_edit") {
		return await input.requireMapped("图像");
	}
	if (req.kind === "text_to_video" || req.kind === "image_to_video") {
		return await input.requireMapped("视频");
	}
	if (req.kind === "image_to_prompt") {
		return await runGeminiImageToPromptTask(c, userId, req);
	}
	if (req.kind === "chat" || req.kind === "prompt_refine") {
		return await input.runMappedOr(() => runGeminiTextTask(c, userId, req));
	}
	throw new AppError(
		"Gemini 目前仅在 Worker 中支持 chat/prompt_refine/image_to_prompt 与 Banana 图像任务",
		{
			status: 400,
			code: "unsupported_task_kind",
		},
	);
}

async function runOpenAiCompatibleTaskWithRouting(
	c: AppContext,
	userId: string,
	vendorRaw: string,
	vendorKey: string,
	req: TaskRequestDto,
	input: {
		mappedOptions?: { forceTaskId: string };
		runMapped: () => Promise<TaskResult | null>;
		runMappedOr: (fallback: () => Promise<TaskResult>) => Promise<TaskResult>;
	},
): Promise<TaskResult> {
	if (req.kind === "chat" || req.kind === "prompt_refine") {
		return await input.runMappedOr(() =>
			runOpenAiCompatibleTextTaskForVendor(c, userId, vendorKey, req),
		);
	}

	if (req.kind === "image_to_prompt") {
		return await runOpenAiCompatibleImageToPromptTaskForVendor(c, userId, vendorKey, req);
	}

	if (req.kind === "text_to_image" || req.kind === "image_edit") {
		const mapped = await input.runMapped();
		if (mapped) return mapped;

		const hasImageModels = await hasEnabledModelCatalogKindForVendor(
			c,
			vendorKey,
			"image",
		);
		if (hasImageModels) {
			throw new AppError(
				`厂商 ${vendorKey} 已配置 image 模型，但未配置可用的图像接口映射（model_catalog_mappings）`,
				{
					status: 400,
					code: "mapping_not_configured",
					details: { vendor: vendorKey, taskKind: req.kind },
				},
			);
		}

		return await runOpenAiCompatibleImageTaskForVendor(
			c,
			userId,
			vendorKey,
			req,
			input.mappedOptions,
		);
	}

	if (req.kind === "text_to_video" || req.kind === "image_to_video") {
		if (vendorKey === "tuzi") {
			return await runTuziVideoTask(c, userId, req);
		}

		const mapped = await input.runMapped();
		if (!mapped) {
			const hasVideoModels = await hasEnabledModelCatalogKindForVendor(
				c,
				vendorKey,
				"video",
			);
			if (hasVideoModels) {
				throw new AppError(
					`厂商 ${vendorKey} 已配置 video 模型，但未配置可用的视频接口映射（model_catalog_mappings）`,
					{
						status: 400,
						code: "mapping_not_configured",
						details: { vendor: vendorKey, taskKind: req.kind },
					},
				);
			}
		}

		return (
			mapped ||
			(await runOpenAiCompatibleVideoTaskForVendor(c, userId, vendorKey, req))
		);
	}

	throw new AppError(`Unsupported vendor: ${vendorRaw}`, {
		status: 400,
		code: "unsupported_vendor",
	});
}

export async function runGenericTaskForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
	req: TaskRequestDto,
	options?: { forceTaskId?: string | null },
): Promise<TaskResult> {
	const v = normalizeVendorKey(vendor);
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
		const mappedOptions = forcedTaskId ? { forceTaskId: forcedTaskId } : undefined;
		const runMapped = () => runMappedTaskForVendorIfConfigured(c, userId, v, req, mappedOptions);
		const runMappedOr = async (fallback: () => Promise<TaskResult>) => {
			const mapped = await runMapped();
			return mapped || (await fallback());
		};
		const requireMapped = async (capabilityLabel: "图像" | "视频") => {
			const mapped = await runMapped();
			if (mapped) return mapped;
			throw new AppError(
				`厂商 ${v} 已启用${capabilityLabel}任务，但未配置可用的${capabilityLabel}接口映射（model_catalog_mappings）`,
				{
					status: 400,
					code: "mapping_not_configured",
					details: { vendor: v, taskKind: req.kind },
				},
			);
		};
		if (v === "openai") {
			if (req.kind === "image_to_prompt") {
				result = await runOpenAiImageToPromptTask(c, userId, req);
			} else if (req.kind === "text_to_image" || req.kind === "image_edit") {
				// OpenAI 文生图在 Worker 侧通过 Gemini Banana / sora2api 代理实现
				throw new AppError(
					"OpenAI 目前仅支持 chat/prompt_refine/image_to_prompt",
					{ status: 400, code: "unsupported_task_kind" },
				);
			} else if (req.kind === "chat" || req.kind === "prompt_refine") {
				result = await runOpenAiTextTask(c, userId, req);
			} else {
				throw new AppError("OpenAI 仅支持 chat/prompt_refine/image_to_prompt", {
					status: 400,
					code: "unsupported_task_kind",
				});
			}
		} else if (v === "apimart") {
			if (req.kind === "text_to_video") {
				result = await runMappedOr(() => runApimartVideoTask(c, userId, req));
			} else if (req.kind === "text_to_image" || req.kind === "image_edit") {
				result = await runMappedOr(() =>
					runApimartImageTask(c, userId, req, mappedOptions),
				);
			} else if (req.kind === "image_to_prompt") {
				result = await runApimartImageToPromptTask(c, userId, req);
			} else if (req.kind === "chat" || req.kind === "prompt_refine") {
				result = await runApimartTextTask(c, userId, req);
			} else {
				throw new AppError(
					"apimart 目前仅支持 chat/prompt_refine/image_to_prompt/text_to_video/text_to_image/image_edit",
					{ status: 400, code: "unsupported_task_kind" },
				);
			}
		} else if (v === "veo") {
			if (req.kind === "text_to_video") {
				result = await requireMapped("视频");
			} else {
				throw new AppError("veo only supports text_to_video tasks", {
					status: 400,
					code: "unsupported_task_kind",
				});
			}
		} else if (v === "gemini") {
			result = await runGeminiTaskWithRouting(c, userId, req, {
				runMapped,
				runMappedOr,
				requireMapped,
			});
		} else if (v === "qwen") {
			if (req.kind === "text_to_image") {
				result = await runMappedOr(() => runQwenTextToImageTask(c, userId, req));
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
			throw new AppError("sora2api 已下线，不再支持调用", {
				status: 410,
				code: "vendor_removed",
				details: { vendor: "sora2api" },
			});
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
		} else if (v === "dreamina-cli" || v === "dreamina") {
			result = await submitDreaminaTask(c, userId, req);
		} else {
			result = await runOpenAiCompatibleTaskWithRouting(c, userId, vendor, v, req, {
				mappedOptions,
				runMapped,
				runMappedOr,
			});
		}

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
			// 将生成结果写入 assets，并异步托管到对象存储（避免阻塞生成响应）。
			try {
				setTraceStage(c, "task:asset_hosting:begin", {
					vendor: apiVendor,
					taskKind: req.kind,
					assetCount: result.assets.length,
				});

				const stagedAssets = await stageTaskAssetsForAsyncHosting({
					c,
					userId,
					assets: result.assets,
					meta: {
						taskKind: req.kind,
						prompt: req.prompt,
						vendor: apiVendor,
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
					assets: stagedAssets,
					raw: {
						...(result.raw as any),
						hosting: { status: "pending", mode: "async" },
						persistAssets,
					},
				});

				setTraceStage(c, "task:asset_hosting:done", {
					vendor: apiVendor,
					taskKind: req.kind,
					hostedCount: stagedAssets.length,
				});
			} catch (err: any) {
				const message =
					typeof err?.message === "string" && err.message.trim()
						? err.message.trim()
						: "OSS 托管失败（已跳过）";
				setTraceStage(c, "task:asset_hosting:error", {
					vendor: apiVendor,
					taskKind: req.kind,
					message: message.slice(0, 300),
				});
			}
		}

		// 统一发出完成事件，便于前端通过 /tasks/stream 或 /tasks/pending 聚合观察
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
