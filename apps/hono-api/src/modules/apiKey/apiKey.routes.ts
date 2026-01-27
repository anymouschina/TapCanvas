import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Hono } from "hono";
import { AppError, errorMiddleware } from "../../middleware/error";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { apiKeyAuthMiddleware } from "./apiKey.middleware";
import { isHttpDebugLogEnabled } from "../../httpDebugLog";
import {
	ApiKeySchema,
	CreateApiKeyRequestSchema,
	CreateApiKeyResponseSchema,
	UpdateApiKeyRequestSchema,
	PublicChatRequestSchema,
	PublicChatResponseSchema,
	PublicRunTaskRequestSchema,
	PublicRunTaskResponseSchema,
	PublicFetchTaskResultRequestSchema,
	PublicFetchTaskResultResponseSchema,
	PublicDrawRequestSchema,
	PublicVideoRequestSchema,
} from "./apiKey.schemas";
import { createApiKey, deleteApiKey, listApiKeys, updateApiKey } from "./apiKey.service";
import {
	fetchApimartTaskResult,
	fetchGrsaiDrawTaskResult,
	fetchMiniMaxTaskResult,
	fetchSora2ApiTaskResult,
	fetchVeoTaskResult,
	runApimartImageTask,
	runApimartVideoTask,
	runGenericTaskForVendor,
	runMiniMaxVideoTask,
	runSora2ApiVideoTask,
	runVeoVideoTask,
} from "../task/task.service";
import { ensureModelCatalogSchema, listCatalogModelsByModelKey } from "../model-catalog/model-catalog.repo";
import { upsertVendorTaskRef, getVendorTaskRefByTaskId } from "../task/vendor-task-refs.repo";

export const apiKeyRouter = new Hono<AppEnv>();
export const publicApiRouter = new OpenAPIHono<AppEnv>({
	defaultHook: (result, c) => {
		if (result.success === false) {
			return c.json(
				{
					error: "Invalid request body",
					issues: result.error.issues,
				},
				400,
			);
		}
	},
});

const PublicValidationErrorSchema = z.object({
	error: z.string(),
	issues: z.array(z.any()).optional(),
});

const PublicAppErrorSchema = z.object({
	message: z.string(),
	error: z.string(),
	code: z.string(),
	details: z.any().optional(),
});

const PublicTaskKindErrorSchema = z.object({
	error: z.string(),
	code: z.string(),
	details: z.any().optional(),
});

const PUBLIC_TAG = "Public API";

function requirePublicUserId(c: any): string {
	const userId = c.get("userId");
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "unauthorized",
		});
	}
	return userId;
}

// ---- Management (dashboard) ----

apiKeyRouter.use("*", authMiddleware);

apiKeyRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const keys = await listApiKeys(c, userId);
	return c.json(ApiKeySchema.array().parse(keys));
});

apiKeyRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateApiKeyRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await createApiKey(c, userId, parsed.data);
	return c.json(CreateApiKeyResponseSchema.parse(result));
});

apiKeyRouter.patch("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateApiKeyRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await updateApiKey(c, userId, id, parsed.data);
	return c.json(ApiKeySchema.parse(result));
});

apiKeyRouter.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteApiKey(c, userId, id);
	return c.body(null, 204);
});

// ---- Public (API key + Origin allowlist) ----

// Ensure public endpoints always return structured JSON errors (instead of a plain 500).
publicApiRouter.use("*", errorMiddleware);
publicApiRouter.use("*", apiKeyAuthMiddleware);

const PublicChatOpenApiRoute = createRoute({
	method: "post",
	path: "/chat",
	tags: [PUBLIC_TAG],
	summary: "文本对话 /public/chat",
	description:
		"通过 X-API-Key 调用文本模型；不传 systemPrompt 时默认使用“请用中文回答。”。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicChatRequestSchema,
					example: {
						vendor: "auto",
						prompt: "你好，帮我用中文回答：TapCanvas 是什么？",
						systemPrompt: "请用中文回答。",
						temperature: 0.7,
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicChatResponseSchema,
					example: {
						id: "task_01HXYZ...",
						vendor: "openai",
						text: "TapCanvas 是一个用于把文字/图片创意组织成可执行工作流的画布工具…",
					},
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: {
				"application/json": {
					schema: PublicValidationErrorSchema,
					example: { error: "Invalid request body", issues: [] },
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
		403: {
			description: "Origin not allowed",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicChatOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);

	const input = c.req.valid("json");

	const vendor = (input.vendor || "openai").trim().toLowerCase();
	const prompt = input.prompt;
	const systemPrompt =
		(typeof input.systemPrompt === "string" && input.systemPrompt.trim()) ||
		"请用中文回答。";

	const req = {
		kind: "chat" as const,
		prompt,
		extras: {
			systemPrompt,
			...(typeof input.modelKey === "string" && input.modelKey.trim()
				? { modelKey: input.modelKey.trim() }
				: {}),
			...(typeof input.temperature === "number"
				? { temperature: input.temperature }
				: {}),
		},
	};

	const result = await runGenericTaskForVendor(c, userId, vendor, req);
	const raw: any = result?.raw as any;
	const text = typeof raw?.text === "string" ? raw.text : "";

	return c.json(
		PublicChatResponseSchema.parse({
			id: result.id,
			vendor,
			text,
		}),
		200,
	);
});

function pickAutoVendorsForKind(kind: string, extras?: Record<string, any> | null): string[] {
	const k = (kind || "").trim();
	if (k === "text_to_image" || k === "image_edit") {
		// Candidate list (filtered by enabled system vendors at runtime).
		return ["gemini", "apimart", "sora2api", "qwen"];
	}
	if (k === "text_to_video") {
		const candidates: string[] = ["veo", "sora2api"];
		const hasMiniMaxFirstFrame =
			typeof extras?.first_frame_image === "string" ||
			typeof extras?.firstFrameImage === "string" ||
			typeof extras?.firstFrameUrl === "string" ||
			typeof extras?.url === "string";
		if (hasMiniMaxFirstFrame) candidates.push("minimax");
		return candidates;
	}
	if (k === "chat" || k === "prompt_refine") {
		return ["openai", "gemini", "anthropic"];
	}
	if (k === "image_to_prompt") {
		return ["openai", "gemini"];
	}
	// Not supported for now (public API can evolve later).
	return [];
}

function normalizeDispatchVendor(vendor: string): string {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return "";
	// allow composite vendors like "comfly:veo" or "grsai:sora2api"
	const parts = raw.split(":").map((p) => p.trim()).filter(Boolean);
	const last = parts.length ? parts[parts.length - 1]! : raw;
	// Alias compatibility: hailuo -> minimax, google -> gemini
	if (last === "hailuo") return "minimax";
	if (last === "google") return "gemini";
	return last;
}

async function listEnabledSystemVendors(c: any): Promise<Set<string>> {
	const isLocalDevRequest = () => {
		try {
			const url = new URL(c?.req?.url);
			const host = url.hostname;
			return (
				host === "localhost" ||
				host === "127.0.0.1" ||
				host === "0.0.0.0" ||
				host === "::1"
			);
		} catch {
			return false;
		}
	};

	try {
		await ensureModelCatalogSchema(c.env.DB);

		const readResults = (res: any): any[] => (res && Array.isArray(res.results) ? res.results : []);

		const vendorsRows = await (async () => {
			try {
				return readResults(
					await c.env.DB.prepare(
						`SELECT key, enabled, auth_type FROM model_catalog_vendors`,
					).all(),
				);
			} catch {
				// Backward-compatible fallback: tolerate older schemas without auth_type.
				return readResults(
					await c.env.DB.prepare(`SELECT * FROM model_catalog_vendors`).all(),
				);
			}
		})();

		const keyRows = await (async () => {
			try {
				// Avoid relying on SQL functions (length) so we can tolerate schema/runtime quirks.
				return readResults(
					await c.env.DB.prepare(
						`SELECT vendor_key, enabled, api_key FROM model_catalog_vendor_api_keys`,
					).all(),
				);
			} catch {
				return readResults(
					await c.env.DB.prepare(
						`SELECT * FROM model_catalog_vendor_api_keys`,
					).all(),
				);
			}
		})();

		const enabledKeyVendors = new Set<string>();
		for (const row of keyRows) {
			const vendorKeyRaw =
				typeof row?.vendor_key === "string"
					? row.vendor_key.trim()
					: typeof row?.vendorKey === "string"
						? row.vendorKey.trim()
						: "";
			const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
			if (!vendorKey) continue;
			if (Number(row?.enabled ?? 1) === 0) continue;

			const apiKey =
				typeof row?.api_key === "string"
					? row.api_key
					: typeof row?.apiKey === "string"
						? row.apiKey
						: "";
			if (!apiKey || !String(apiKey).trim()) continue;

			enabledKeyVendors.add(vendorKey);
		}

		const enabledVendors = new Set<string>();
		for (const row of vendorsRows) {
			const vendorKeyRaw =
				typeof row?.key === "string"
					? row.key.trim()
					: typeof row?.vendor_key === "string"
						? row.vendor_key.trim()
						: typeof row?.vendorKey === "string"
							? row.vendorKey.trim()
							: "";
			const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
			if (!vendorKey) continue;
			if (Number(row?.enabled ?? 1) === 0) continue;

			const authType =
				typeof row?.auth_type === "string"
					? row.auth_type.trim().toLowerCase()
					: typeof row?.authType === "string"
						? row.authType.trim().toLowerCase()
						: "";
			if (authType === "none" || enabledKeyVendors.has(vendorKey)) {
				enabledVendors.add(vendorKey);
			}
		}

		return enabledVendors;
	} catch (err: any) {
		if (isLocalDevRequest()) {
			console.warn(
				"[public-api] listEnabledSystemVendors failed",
				err?.message || err,
			);
		}
		return new Set();
	}
}

function filterVendorsByEnabledSystemConfig(
	candidates: string[],
	enabledSystemVendors: Set<string>,
): string[] {
	const output: string[] = [];
	for (const candidate of candidates) {
		const v = normalizeDispatchVendor(candidate);
		if (!v) continue;
		if (!enabledSystemVendors.has(v)) continue;
		if (!output.includes(candidate)) output.push(candidate);
	}
	return output;
}

function resolveCatalogKindForTaskKind(
	taskKind: string | null | undefined,
): "text" | "image" | "video" | null {
	const k = (taskKind || "").trim();
	if (!k) return null;
	if (k === "chat" || k === "prompt_refine" || k === "image_to_prompt") return "text";
	if (k === "text_to_image" || k === "image_edit") return "image";
	if (k === "text_to_video" || k === "image_to_video") return "video";
	return null;
}

async function resolvePreferredVendorFromModelCatalog(
	c: any,
	taskKind: string | null | undefined,
	extras: Record<string, any>,
	vendorCandidates: string[],
): Promise<string | null> {
	const raw =
		typeof extras?.modelKey === "string" && extras.modelKey.trim()
			? extras.modelKey.trim()
			: "";
	if (!raw) return null;

	const expectedKind = resolveCatalogKindForTaskKind(taskKind);
	const candidates = Array.from(
		new Set([raw, raw.startsWith("models/") ? raw.slice(7) : ""]).values(),
	).filter(Boolean);

	for (const modelKey of candidates) {
		try {
			const rows = await listCatalogModelsByModelKey(c.env.DB, modelKey);
			if (!rows.length) continue;

			const eligibleVendorKeys = new Set<string>();
			for (const row of rows) {
				if (!row) continue;
				if (Number((row as any).enabled ?? 1) === 0) continue;
				const kindRaw =
					typeof (row as any).kind === "string" ? (row as any).kind.trim() : "";
				if (expectedKind && kindRaw && kindRaw !== expectedKind) continue;
				const vendorKey =
					typeof (row as any).vendor_key === "string"
						? (row as any).vendor_key.trim()
						: "";
				const normalized = normalizeDispatchVendor(vendorKey);
				if (normalized) eligibleVendorKeys.add(normalized);
			}

			if (!eligibleVendorKeys.size) continue;

			for (const candidateVendor of vendorCandidates) {
				const normalized = normalizeDispatchVendor(candidateVendor);
				if (normalized && eligibleVendorKeys.has(normalized)) return normalized;
			}

			// Fall back to deterministic pick to preserve legacy behavior
			// (modelKey may map to vendors outside the default candidate list).
			const sorted = Array.from(eligibleVendorKeys.values()).sort((a, b) =>
				a.localeCompare(b),
			);
			return sorted[0] || null;
		} catch {
			continue;
		}
	}

	return null;
}

async function runPublicTaskWithFallback(
	c: any,
	userId: string,
	input: any,
): Promise<{ vendor: string; result: any }> {
	const request = input.request;
	const extras = (request?.extras || {}) as Record<string, any>;
	const debug = isHttpDebugLogEnabled(c);
	const debugLog = (event: string, payload: Record<string, unknown>) => {
		if (!debug) return;
		try {
			console.log(
				JSON.stringify({
					ts: new Date().toISOString(),
					type: "public_task_debug",
					event,
					...payload,
				}),
			);
		} catch {
			// best-effort only
		}
	};

	// Hint proxy selector: prefer higher-success channels for this task kind.
	if (request?.kind) c.set("routingTaskKind", request.kind);

	const vendorRaw = (input.vendor || "auto").trim().toLowerCase();
	const enabledSystemVendors = await listEnabledSystemVendors(c);
	const isAutoVendor = vendorRaw === "auto";
	const rawCandidates = isAutoVendor ? pickAutoVendorsForKind(request.kind, extras) : [vendorRaw];
	// NOTE:
	// - vendor=auto: only use system-enabled vendors (admin-configured global allowlist)
	// - vendor=explicit: allow user-level proxy/provider configs to work (even if not in system allowlist)
	let vendorCandidates = isAutoVendor
		? filterVendorsByEnabledSystemConfig(rawCandidates, enabledSystemVendors)
		: rawCandidates.filter((v) => !!normalizeDispatchVendor(v));

	debugLog("vendor_candidates_resolved", {
		taskKind: request?.kind ?? null,
		vendorRaw: vendorRaw || null,
		rawCandidates,
		vendorCandidates,
		systemEnabledVendors: Array.from(enabledSystemVendors.values()),
		modelKey:
			typeof extras?.modelKey === "string" && extras.modelKey.trim()
				? extras.modelKey.trim()
				: null,
	});

	if (isAutoVendor) {
		const preferred = await resolvePreferredVendorFromModelCatalog(
			c,
			request.kind,
			extras,
			vendorCandidates,
		);
		if (preferred && enabledSystemVendors.has(preferred)) {
			vendorCandidates = [
				preferred,
				...vendorCandidates.filter(
					(v) => normalizeDispatchVendor(v) !== normalizeDispatchVendor(preferred),
				),
			];
		}
	}

	if (!vendorCandidates.length) {
		if (!rawCandidates.length) {
			return Promise.reject(
				Object.assign(new Error("unsupported task kind"), {
					status: 400,
					code: "unsupported_task_kind",
					details: { kind: request?.kind },
				}),
			);
		}
		throw new AppError(
			"没有可用的全局厂商配置（请在 /stats -> 模型管理（系统级）启用并配置 API Key）",
			{
				status: 400,
				code: "no_enabled_vendor",
				details: {
					kind: request?.kind,
					vendorRaw: vendorRaw || null,
					rawCandidates,
					systemEnabledVendors: Array.from(enabledSystemVendors.values()),
					modelKey:
						typeof extras?.modelKey === "string" && extras.modelKey.trim()
							? extras.modelKey.trim()
							: null,
				},
			},
		);
	}

	let lastErr: any = null;
	let lastFailed: { vendor: string; result: any } | null = null;
	for (const vendorCandidate of vendorCandidates) {
		const v = normalizeDispatchVendor(vendorCandidate);
		try {
			let result: any;
			if (v === "apimart") {
				if (request.kind === "text_to_video") {
					result = await runApimartVideoTask(c, userId, request);
					const nowIso = new Date().toISOString();
					await upsertVendorTaskRef(
						c.env.DB,
						userId,
						{ kind: "video", taskId: result.id, vendor: "apimart" },
						nowIso,
					);
				} else if (
					request.kind === "text_to_image" ||
					request.kind === "image_edit"
				) {
					result = await runApimartImageTask(c, userId, request);
					const nowIso = new Date().toISOString();
					await upsertVendorTaskRef(
						c.env.DB,
						userId,
						{ kind: "image", taskId: result.id, vendor: "apimart" },
						nowIso,
					);
				} else {
					throw Object.assign(new Error("invalid task kind"), {
						status: 400,
						code: "invalid_task_kind",
						details: { vendor: "apimart", kind: request.kind },
					});
				}
			} else if (v === "veo") {
				if (request.kind !== "text_to_video") {
					throw Object.assign(new Error("invalid task kind"), {
						status: 400,
						code: "invalid_task_kind",
						details: { vendor: "veo", kind: request.kind },
					});
				}
				result = await runVeoVideoTask(c, userId, request);
				// Ensure public polling can infer vendor for this task.
				const nowIso = new Date().toISOString();
				const rawProvider =
					typeof result?.raw?.provider === "string"
						? result.raw.provider.trim().toLowerCase()
						: "";
				const vendorForRef =
					rawProvider === "comfly"
						? "comfly:veo"
						: rawProvider === "sora2api"
							? "sora2api:veo"
							: rawProvider === "apimart"
								? "apimart:veo"
							: "direct:veo";
				await upsertVendorTaskRef(
					c.env.DB,
					userId,
					{ kind: "video", taskId: result.id, vendor: vendorForRef },
					nowIso,
				);
			} else if (v === "minimax") {
				if (request.kind !== "text_to_video") {
					throw Object.assign(new Error("invalid task kind"), {
						status: 400,
						code: "invalid_task_kind",
						details: { vendor: "minimax", kind: request.kind },
					});
				}
				result = await runMiniMaxVideoTask(c, userId, request);
				const nowIso = new Date().toISOString();
				await upsertVendorTaskRef(
					c.env.DB,
					userId,
					{ kind: "video", taskId: result.id, vendor: "minimax" },
					nowIso,
				);
			} else if (v === "sora2api") {
				if (request.kind !== "text_to_video") {
					// sora2api image tasks are handled by generic runner
					result = await runGenericTaskForVendor(c, userId, v, request);
				} else {
					result = await runSora2ApiVideoTask(c, userId, request);
				}
				// sora2api runner persists vendor refs internally when needed.
			} else {
				result = await runGenericTaskForVendor(c, userId, v, request);
			}

			// For public endpoints, a failed TaskResult should trigger vendor fallback
			// (e.g. missing token / upstream transient issues).
			if (result?.status === "failed") {
				lastFailed = { vendor: v, result };
				continue;
			}

			return { vendor: v, result };
		} catch (err: any) {
			debugLog("vendor_candidate_failed", {
				taskKind: request?.kind ?? null,
				vendorCandidate,
				dispatchVendor: v || null,
				error: {
					name: typeof err?.name === "string" ? err.name : undefined,
					message: typeof err?.message === "string" ? err.message : String(err),
					status:
						typeof err?.status === "number"
							? err.status
							: Number.isFinite(Number(err?.status))
								? Number(err.status)
								: undefined,
					code: typeof err?.code === "string" ? err.code : undefined,
					details: err?.details ?? undefined,
				},
			});
			lastErr = err;
			continue;
		}
	}

	if (lastFailed) return lastFailed;
	throw lastErr || new Error("run public task failed");
}

// Unified public task API: supports image/video/chat via API key.
const PublicRunTaskOpenApiRoute = createRoute({
	method: "post",
	path: "/tasks",
	tags: [PUBLIC_TAG],
	summary: "统一任务入口 /public/tasks",
	description:
		"统一任务入口：当你希望完全复用内部 TaskRequest 结构时使用（支持 image/video/chat 等）。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicRunTaskRequestSchema,
					example: {
						vendor: "auto",
						request: {
							kind: "text_to_video",
							prompt: "雨夜霓虹街头，一只白猫缓慢走过…",
							extras: { modelKey: "veo3.1-fast", durationSeconds: 10 },
						},
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicRunTaskResponseSchema,
					example: {
						vendor: "veo",
						result: {
							id: "task_01HXYZ...",
							kind: "text_to_video",
							status: "queued",
							assets: [],
							raw: {},
						},
					},
				},
			},
		},
		400: {
			description: "Invalid request body / unsupported task kind",
			content: {
				"application/json": {
					schema: z.union([PublicValidationErrorSchema, PublicTaskKindErrorSchema]),
					example: {
						error: "Unsupported task kind for public API",
						code: "unsupported_task_kind",
						details: { kind: "image_to_video" },
					},
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
		403: {
			description: "Origin not allowed",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicRunTaskOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);

	const input = c.req.valid("json");

	try {
		const { vendor, result } = await runPublicTaskWithFallback(
			c,
			userId,
			input,
		);
		return c.json(
			PublicRunTaskResponseSchema.parse({
				vendor,
				result,
			}),
			200,
		);
	} catch (err: any) {
		if (err?.code === "unsupported_task_kind") {
			return c.json(
				{
					error: "Unsupported task kind for public API",
					code: "unsupported_task_kind",
					details: err?.details ?? null,
				},
				400,
			);
		}
		throw err;
	}
});

// Convenience endpoints (explicit "draw" / "video" naming) for external callers.
const PublicDrawOpenApiRoute = createRoute({
	method: "post",
	path: "/draw",
	tags: [PUBLIC_TAG],
	summary: "绘图 /public/draw",
	description:
		"便捷绘图接口：创建 text_to_image 或 image_edit 任务（会自动 vendor 回退）。支持通过 width/height 或 extras.aspectRatio/extras.resolution 配置尺寸/分辨率，但不同 vendor 支持不一致；如需严格像素宽高，建议指定 vendor=qwen。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicDrawRequestSchema,
					example: {
						vendor: "auto",
						kind: "text_to_image",
						prompt: "一张电影感海报，中文“TapCanvas”，高细节，干净背景",
						extras: { modelKey: "nano-banana-pro", aspectRatio: "1:1" },
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicRunTaskResponseSchema,
					example: {
						vendor: "gemini",
						result: {
							id: "task_01HXYZ...",
							kind: "text_to_image",
							status: "queued",
							assets: [],
							raw: {},
						},
					},
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: {
				"application/json": {
					schema: PublicValidationErrorSchema,
					example: { error: "Invalid request body", issues: [] },
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
		403: {
			description: "Origin not allowed",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicDrawOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);
	const input = c.req.valid("json");

	const request = {
		kind: input.kind || "text_to_image",
		prompt: input.prompt,
		...(typeof input.negativePrompt === "string"
			? { negativePrompt: input.negativePrompt }
			: {}),
		...(typeof input.seed === "number" ? { seed: input.seed } : {}),
		...(typeof input.width === "number" ? { width: input.width } : {}),
		...(typeof input.height === "number"
			? { height: input.height }
			: {}),
		...(typeof input.steps === "number" ? { steps: input.steps } : {}),
		...(typeof input.cfgScale === "number"
			? { cfgScale: input.cfgScale }
			: {}),
		...(input.extras ? { extras: input.extras } : {}),
	};

	const { vendor, result } = await runPublicTaskWithFallback(c, userId, {
		vendor: input.vendor,
		request,
	});

	return c.json(
		PublicRunTaskResponseSchema.parse({
			vendor,
			result,
		}),
		200,
	);
});

const PublicVideoOpenApiRoute = createRoute({
	method: "post",
	path: "/video",
	tags: [PUBLIC_TAG],
	summary: "生成视频 /public/video",
	description:
		"便捷视频接口：创建 text_to_video 任务（会自动 vendor 回退；可通过 extras.modelKey 指定模型）。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicVideoRequestSchema,
					example: {
						vendor: "auto",
						prompt: "雨夜霓虹街头，一只白猫缓慢走过…",
						durationSeconds: 10,
						extras: { modelKey: "veo3.1-fast" },
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicRunTaskResponseSchema,
					example: {
						vendor: "veo",
						result: {
							id: "task_01HXYZ...",
							kind: "text_to_video",
							status: "queued",
							assets: [],
							raw: {},
						},
					},
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: {
				"application/json": {
					schema: PublicValidationErrorSchema,
					example: { error: "Invalid request body", issues: [] },
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
		403: {
			description: "Origin not allowed",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicVideoOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);
	const input = c.req.valid("json");

	const extras: Record<string, any> = input.extras ? { ...input.extras } : {};
	if (typeof input.durationSeconds === "number") {
		extras.durationSeconds = input.durationSeconds;
	}

	const request = {
		kind: "text_to_video",
		prompt: input.prompt,
		extras,
	};

	const { vendor, result } = await runPublicTaskWithFallback(c, userId, {
		vendor: input.vendor,
		request,
	});

	return c.json(
		PublicRunTaskResponseSchema.parse({
			vendor,
			result,
		}),
		200,
	);
});

// Unified public polling API: resolve vendor via vendor_task_refs when possible.
const PublicFetchTaskResultOpenApiRoute = createRoute({
	method: "post",
	path: "/tasks/result",
	tags: [PUBLIC_TAG],
	summary: "查询任务结果 /public/tasks/result",
	description: "轮询任务状态与结果；支持 vendor=auto 自动基于 taskId 推断。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicFetchTaskResultRequestSchema,
					example: { taskId: "task_01HXYZ...", taskKind: "text_to_video" },
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicFetchTaskResultResponseSchema,
					example: {
						vendor: "veo",
						result: {
							id: "task_01HXYZ...",
							kind: "text_to_video",
							status: "running",
							assets: [],
							raw: {},
						},
					},
				},
			},
		},
		400: {
			description: "Invalid request body / vendor required",
			content: {
				"application/json": {
					schema: z.union([PublicValidationErrorSchema, PublicTaskKindErrorSchema]),
					example: {
						error: "vendor is required (or the task vendor cannot be inferred)",
						code: "vendor_required",
					},
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
		403: {
			description: "Origin not allowed",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicFetchTaskResultOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);

	const input = c.req.valid("json");

	const taskId = input.taskId.trim();
	const vendorInput = (input.vendor || "").trim();
	const taskKind = input.taskKind ?? null;
	const prompt = typeof input.prompt === "string" ? input.prompt : null;

	const resolveRefKind = (): "video" | "image" | null => {
		if (taskKind === "text_to_video" || taskKind === "image_to_video") return "video";
		if (taskKind === "text_to_image" || taskKind === "image_edit") return "image";
		return null;
	};

	const resolved: {
		vendor: string;
		kind: "video" | "image" | null;
	} = { vendor: vendorInput, kind: resolveRefKind() };

	if (!resolved.vendor || resolved.vendor.toLowerCase() === "auto") {
		const tryKinds: Array<"video" | "image"> = resolved.kind
			? [resolved.kind]
			: ["video", "image"];
		for (const k of tryKinds) {
			const ref = await getVendorTaskRefByTaskId(c.env.DB, userId, k, taskId);
			if (ref?.vendor) {
				resolved.vendor = ref.vendor;
				resolved.kind = k;
				break;
			}
		}
	}

	if (!resolved.vendor) {
		return c.json(
			{
				error: "vendor is required (or the task vendor cannot be inferred)",
				code: "vendor_required",
			},
			400,
		);
	}

	// If the stored vendor encodes a proxy/channel (e.g. "comfly:veo"),
	// force that proxy so polling hits the correct upstream.
	{
		const raw = resolved.vendor.trim().toLowerCase();
		const head = raw.split(":")[0]?.trim() || "";
		if (head === "direct") {
			try {
				c.set("proxyDisabled", true);
			} catch {
				// ignore
			}
		}
		const hint =
			head === "comfly" || raw.startsWith("comfly-")
				? "comfly"
				: head === "grsai" || raw.startsWith("grsai-")
					? "grsai"
					: null;
		if (hint) {
			try {
				c.set("proxyVendorHint", hint);
			} catch {
				// ignore
			}
		}
	}

	// Hint proxy selector: prefer higher-success channels for this task kind.
	if (taskKind) c.set("routingTaskKind", taskKind);

	const vendorHead = resolved.vendor.trim().toLowerCase().split(":")[0]?.trim() || "";
	const dispatch = normalizeDispatchVendor(resolved.vendor);
	let result: any;

	if (dispatch === "apimart") {
		result = await fetchApimartTaskResult(c, userId, taskId, prompt, {
			taskKind: (taskKind as any) ?? null,
		});
	} else if (resolved.kind === "image") {
		result = await fetchGrsaiDrawTaskResult(c, userId, taskId, {
			taskKind: (taskKind as any) ?? null,
			promptFromClient: prompt,
		});
	} else if (vendorHead === "sora2api") {
		result = await fetchSora2ApiTaskResult(c, userId, taskId, prompt);
	} else if (dispatch === "veo") {
		result = await fetchVeoTaskResult(c, userId, taskId);
	} else if (dispatch === "minimax") {
		result = await fetchMiniMaxTaskResult(c, userId, taskId);
	} else {
		// Default: sora2api/grsai-compatible video polling.
		result = await fetchSora2ApiTaskResult(c, userId, taskId, prompt);
	}

	return c.json(
		PublicFetchTaskResultResponseSchema.parse({
			vendor: resolved.vendor,
			result,
		}),
		200,
	);
});
