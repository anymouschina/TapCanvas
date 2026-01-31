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
	fetchAsyncDataTaskResult,
	fetchTuziTaskResult,
	fetchGrsaiDrawTaskResult,
	fetchMiniMaxTaskResult,
	fetchSora2ApiTaskResult,
	fetchVeoTaskResult,
	runApimartImageTask,
	runApimartVideoTask,
	runMiniMaxVideoTask,
	runSora2ApiVideoTask,
	runVeoVideoTask,
	runGenericTaskForVendor,
	enqueueStoredTaskForVendor,
} from "../task/task.service";
import {
	ensureModelCatalogSchema,
	listCatalogModelsByModelAlias,
	listCatalogModelsByModelKey,
} from "../model-catalog/model-catalog.repo";
import { getTaskResultByTaskId, upsertTaskResult } from "../task/task-result.repo";
import { upsertVendorTaskRef, getVendorTaskRefByTaskId } from "../task/vendor-task-refs.repo";
import { ensureVendorCallLogsSchema } from "../task/vendor-call-logs.repo";
import { setTraceStage } from "../../trace";

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

	const prompt = input.prompt;
	const systemPrompt =
		(typeof input.systemPrompt === "string" && input.systemPrompt.trim()) ||
		"请用中文回答。";

	const request = {
		kind: "chat" as const,
		prompt,
		extras: {
			systemPrompt,
			...(typeof input.modelAlias === "string" && input.modelAlias.trim()
				? { modelAlias: input.modelAlias.trim() }
				: {}),
			...(typeof input.modelKey === "string" && input.modelKey.trim()
				? { modelKey: input.modelKey.trim() }
				: {}),
			...(typeof input.temperature === "number"
				? { temperature: input.temperature }
				: {}),
		},
	};

	const { vendor, result } = await runPublicTaskWithFallback(c, userId, {
		vendor: input.vendor ?? "auto",
		request,
	});
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

function isPublicTaskKindSupported(kind: string): boolean {
	const k = (kind || "").trim();
	return (
		k === "text_to_image" ||
		k === "image_edit" ||
		k === "text_to_video" ||
		k === "chat" ||
		k === "prompt_refine" ||
		k === "image_to_prompt"
	);
}

function pickAutoVendorsForKind(
	kind: string,
	enabledSystemVendors: Set<string>,
	extras?: Record<string, any> | null,
): string[] {
	const k = (kind || "").trim();
	const enabled = enabledSystemVendors || new Set<string>();
	const output: string[] = [];

	const addIfEnabled = (vendor: string) => {
		const v = normalizeDispatchVendor(vendor);
		if (!v) return;
		if (!enabled.has(v)) return;
		if (!output.includes(v)) output.push(v);
	};

	const addEnabledTextVendors = () => {
		// Exclude known non-text protocols/channels to avoid predictable failures.
		const nonText = new Set([
			"apimart",
			"veo",
			"sora2api",
			"qwen",
			"minimax",
			"grsai",
			"comfly",
			"yunwu",
		]);
		const rest = Array.from(enabled.values())
			.map((v) => normalizeDispatchVendor(v))
			.filter((v): v is string => !!v)
			.filter((v) => !output.includes(v))
			.filter((v) => !nonText.has(v))
			.sort((a, b) => a.localeCompare(b));
		for (const v of rest) output.push(v);
	};

	if (k === "text_to_image" || k === "image_edit") {
		["gemini", "apimart", "sora2api", "qwen"].forEach(addIfEnabled);
		return output;
	}
	if (k === "text_to_video") {
		["veo", "sora2api", "apimart"].forEach(addIfEnabled);
		const hasMiniMaxFirstFrame =
			typeof extras?.first_frame_image === "string" ||
			typeof extras?.firstFrameImage === "string" ||
			typeof extras?.firstFrameUrl === "string" ||
			typeof extras?.url === "string";
		if (hasMiniMaxFirstFrame) addIfEnabled("minimax");
		return output;
	}
	if (k === "chat" || k === "prompt_refine") {
		["openai", "gemini", "anthropic"].forEach(addIfEnabled);
		addEnabledTextVendors();
		return output;
	}
	if (k === "image_to_prompt") {
		["openai", "gemini"].forEach(addIfEnabled);
		return output;
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

function normalizeProxyVendorHint(vendor: string): string | null {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return null;
	const head = raw.split(":")[0]?.trim() || raw;
	if (head === "comfly" || raw.startsWith("comfly-")) return "comfly";
	if (head === "grsai" || raw.startsWith("grsai-")) return "grsai";
	if (head === "apimart" || raw.startsWith("apimart-")) return "apimart";
	if (head === "yunwu" || raw.startsWith("yunwu-")) return "yunwu";
	return null;
}

function shouldUseGrsaiDrawPollingForImageTask(vendor: string): boolean {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return false;
	// Legacy compatibility: Gemini image tasks are polled via grsai draw result.
	if (raw === "gemini" || raw === "google") return true;
	// Banana/grsai draw vendor refs are stored like "grsai-nano-banana-*" / "comfly-*" / "apimart-*".
	if (raw === "grsai" || raw.startsWith("grsai-") || raw.startsWith("grsai:")) return true;
	if (raw === "comfly" || raw.startsWith("comfly-") || raw.startsWith("comfly:")) return true;
	if (raw.startsWith("apimart-") || raw.startsWith("apimart:")) return true;
	return false;
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

async function rankVendorsByRecentPerformance(
	c: any,
	userId: string,
	taskKind: string | null | undefined,
	vendorCandidates: string[],
): Promise<string[]> {
	if (!vendorCandidates.length) return [];
	const deduped = Array.from(
		new Set(vendorCandidates.map((v) => normalizeDispatchVendor(v)).filter(Boolean)),
	);
	if (deduped.length <= 1) return deduped;

	const taskKindFilter = typeof taskKind === "string" && taskKind.trim() ? taskKind.trim() : null;
	const isVideoTaskKind =
		taskKindFilter === "text_to_video" || taskKindFilter === "image_to_video";

	try {
		await ensureVendorCallLogsSchema(c.env.DB);
	} catch {
		return deduped;
	}

	const scoreVendor = async (vendor: string) => {
		const v = normalizeDispatchVendor(vendor);
		if (!v) return { vendor, rate: 0.5, total: 0, avgMs: Number.POSITIVE_INFINITY };
		try {
			const vendorWhere =
				isVideoTaskKind && v === "sora2api"
					? "(vendor = ? OR vendor LIKE 'grsai-%')"
					: "vendor = ?";
			const where: string[] = [
				"user_id = ?",
				vendorWhere,
				"status IN ('succeeded','failed')",
				"finished_at IS NOT NULL",
			];
			const bindings: unknown[] = [userId, v];
			if (taskKindFilter) {
				where.push("task_kind = ?");
				bindings.push(taskKindFilter);
			}
			if (!isVideoTaskKind) {
				const sinceIso = new Date(
					Date.now() - 7 * 24 * 60 * 60 * 1000,
				).toISOString();
				where.push("finished_at >= ?");
				bindings.push(sinceIso);
			}
			const row = await c.env.DB.prepare(
				`
          SELECT
            COUNT(1) AS total,
            SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS success,
            AVG(CASE WHEN status = 'succeeded' THEN duration_ms ELSE NULL END) AS avg_ms
          FROM vendor_api_call_logs
          WHERE ${where.join(" AND ")}
        `,
			)
				.bind(...bindings)
				.first<any>();

			const total = Number(row?.total ?? 0) || 0;
			const success = Number(row?.success ?? 0) || 0;
			const rate = (success + 1) / (total + 2); // Laplace smoothing
			const avgRaw = Number(row?.avg_ms);
			const avgMs = Number.isFinite(avgRaw) && avgRaw >= 0 ? avgRaw : Number.POSITIVE_INFINITY;
			return { vendor: v, rate, total, avgMs };
		} catch {
			return { vendor: v, rate: 0.5, total: 0, avgMs: Number.POSITIVE_INFINITY };
		}
	};

	const scored = await Promise.all(deduped.map((v) => scoreVendor(v)));

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
			const shuffled = [...deduped];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = randomInt(i + 1);
				const tmp = shuffled[i]!;
				shuffled[i] = shuffled[j]!;
				shuffled[j] = tmp;
			}
			return shuffled;
		}

		const sorted = scored.sort((a, b) => {
			if (b.rate !== a.rate) return b.rate - a.rate;
			if (a.avgMs !== b.avgMs) return a.avgMs - b.avgMs;
			if (b.total !== a.total) return b.total - a.total;
			return a.vendor.localeCompare(b.vendor);
		});
		return sorted.map((s) => s.vendor);
	}

	const enriched = scored.map((s) => ({
		...s,
		// Prefer faster expected time-to-success (avgMs / successRate), then more reliable.
		expectedMs:
			s.avgMs === Number.POSITIVE_INFINITY
				? Number.POSITIVE_INFINITY
				: s.avgMs / Math.max(0.001, s.rate),
	}));
	const sorted = enriched.sort((a, b) => {
		if (a.expectedMs !== b.expectedMs) return a.expectedMs - b.expectedMs;
		if (b.rate !== a.rate) return b.rate - a.rate;
		if (a.avgMs !== b.avgMs) return a.avgMs - b.avgMs;
		if (b.total !== a.total) return b.total - a.total;
		return a.vendor.localeCompare(b.vendor);
	});
	return sorted.map((s) => s.vendor);
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
	setTraceStage(c, "public:run:begin", {
		taskKind: request?.kind ?? null,
		vendor: typeof input?.vendor === "string" ? input.vendor : null,
		modelAlias:
			typeof extras?.modelAlias === "string" && extras.modelAlias.trim()
				? extras.modelAlias.trim()
				: null,
	});
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
	const explicitVendor = !isAutoVendor ? normalizeDispatchVendor(vendorRaw) : "";
	if (explicitVendor && !enabledSystemVendors.has(explicitVendor)) {
		throw new AppError("该厂商已禁用或未配置（系统级）", {
			status: 400,
			code: "vendor_disabled",
			details: {
				vendorRaw: vendorRaw || null,
				vendor: explicitVendor,
				systemEnabledVendors: Array.from(enabledSystemVendors.values()),
			},
		});
	}

	const modelAliasRaw =
		typeof extras?.modelAlias === "string" && extras.modelAlias.trim()
			? extras.modelAlias.trim()
			: "";

	const rawCandidates = isAutoVendor
		? modelAliasRaw
			? Array.from(enabledSystemVendors.values()).sort((a, b) => a.localeCompare(b))
			: pickAutoVendorsForKind(request.kind, enabledSystemVendors, extras)
		: [vendorRaw];
	let vendorCandidates = isAutoVendor
		? rawCandidates
		: rawCandidates.filter((v) => !!normalizeDispatchVendor(v));

	const modelKeyByVendorFromAlias = (async (): Promise<Map<string, string> | null> => {
		if (!modelAliasRaw) return null;
		const expectedKind = resolveCatalogKindForTaskKind(request?.kind ?? null);
		try {
			const rows = await listCatalogModelsByModelAlias(c.env.DB, modelAliasRaw);
			const map = new Map<string, string>();
			for (const row of rows) {
				if (!row) continue;
				if (Number((row as any).enabled ?? 1) === 0) continue;
				const kindRaw =
					typeof (row as any).kind === "string" ? (row as any).kind.trim() : "";
				if (expectedKind && kindRaw && kindRaw !== expectedKind) continue;
				const vendorKeyRaw =
					typeof (row as any).vendor_key === "string"
						? (row as any).vendor_key.trim()
						: "";
				const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
				if (!vendorKey) continue;
				const modelKey =
					typeof (row as any).model_key === "string"
						? (row as any).model_key.trim()
						: "";
				if (!modelKey) continue;
				if (!map.has(vendorKey)) map.set(vendorKey, modelKey);
			}
			return map;
		} catch {
			return new Map();
		}
	})();

	const aliasMap = await modelKeyByVendorFromAlias;
	if (modelAliasRaw) {
		const supported =
			aliasMap && aliasMap.size
				? vendorCandidates.filter((candidate) => {
						const v = normalizeDispatchVendor(candidate);
						return !!v && aliasMap.has(v);
					})
				: [];

		if (!supported.length) {
			throw new AppError("未找到可用的模型别名配置（请在 /stats -> 模型管理（系统级）为该别名配置并启用模型）", {
				status: 400,
				code: "model_alias_not_found",
				details: {
					taskKind: request?.kind ?? null,
					vendorRaw: vendorRaw || null,
					rawCandidates,
					systemEnabledVendors: Array.from(enabledSystemVendors.values()),
					modelAlias: modelAliasRaw,
				},
			});
		}

		// Enforce alias selection: only try vendors that have the alias mapped.
		vendorCandidates = supported;
	}

	debugLog("vendor_candidates_resolved", {
		taskKind: request?.kind ?? null,
		vendorRaw: vendorRaw || null,
		rawCandidates,
		vendorCandidates,
		systemEnabledVendors: Array.from(enabledSystemVendors.values()),
		modelAlias: modelAliasRaw || null,
		modelKey:
			typeof extras?.modelKey === "string" && extras.modelKey.trim()
				? extras.modelKey.trim()
				: null,
	});
	setTraceStage(c, "public:vendors:resolved", {
		taskKind: request?.kind ?? null,
		vendorRaw: vendorRaw || null,
		vendorCandidates: vendorCandidates.slice(0, 12),
		modelAlias: modelAliasRaw || null,
	});

	let preferredVendor: string | null = null;
	if (isAutoVendor && !modelAliasRaw) {
		preferredVendor = await resolvePreferredVendorFromModelCatalog(
			c,
			request.kind,
			extras,
			vendorCandidates,
		);
	}

	if (isAutoVendor && vendorCandidates.length > 1) {
		vendorCandidates = await rankVendorsByRecentPerformance(
			c,
			userId,
			request?.kind ?? null,
			vendorCandidates,
		);
	}

	if (preferredVendor && enabledSystemVendors.has(preferredVendor)) {
		vendorCandidates = [
			preferredVendor,
			...vendorCandidates.filter(
				(v) => normalizeDispatchVendor(v) !== normalizeDispatchVendor(preferredVendor),
			),
		];
	}

	if (!vendorCandidates.length) {
		if (isAutoVendor && !isPublicTaskKindSupported(request?.kind)) {
			return Promise.reject(
				Object.assign(new Error("unsupported task kind"), {
					status: 400,
					code: "unsupported_task_kind",
					details: { kind: request?.kind },
				}),
			);
		}
		if (!isAutoVendor && !rawCandidates.length) {
			return Promise.reject(
				Object.assign(new Error("unsupported task kind"), {
					status: 400,
					code: "unsupported_task_kind",
					details: { kind: request?.kind },
				}),
			);
		}
		if (!isAutoVendor) {
			throw new AppError("无效的 vendor 参数", {
				status: 400,
				code: "invalid_vendor",
				details: { vendor: vendorRaw || null },
			});
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
		setTraceStage(c, "public:vendor:attempt", {
			taskKind: request?.kind ?? null,
			vendorCandidate,
			dispatchVendor: v || null,
		});
		try {
			const requestForVendor = (() => {
				if (!modelAliasRaw) {
					// Ensure local-only fields don't leak upstream.
					const cleanExtras = { ...(request?.extras || {}) } as Record<string, any>;
					delete (cleanExtras as any).modelAlias;
					return { ...request, extras: cleanExtras };
				}

				const mappedModelKey = aliasMap?.get(v || "");
				if (!mappedModelKey) {
					// vendorCandidates should already be filtered, but keep a defensive fallback.
					throw new AppError("未找到别名对应的模型 Key", {
						status: 400,
						code: "model_alias_not_found",
						details: {
							taskKind: request?.kind ?? null,
							vendor: v || null,
							modelAlias: modelAliasRaw,
						},
					});
				}

				const cleanExtras = { ...(request?.extras || {}) } as Record<string, any>;
				delete (cleanExtras as any).modelAlias;
				cleanExtras.modelKey = mappedModelKey;
				return { ...request, extras: cleanExtras };
			})();

			let result: any;
			if (v === "apimart") {
				if (requestForVendor.kind === "text_to_video") {
					result = await runApimartVideoTask(c, userId, requestForVendor);
					const nowIso = new Date().toISOString();
					await upsertVendorTaskRef(
						c.env.DB,
						userId,
						{ kind: "video", taskId: result.id, vendor: "apimart" },
						nowIso,
					);
				} else if (
					requestForVendor.kind === "text_to_image" ||
					requestForVendor.kind === "image_edit"
				) {
					result = await runApimartImageTask(c, userId, requestForVendor);
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
				if (requestForVendor.kind !== "text_to_video") {
					throw Object.assign(new Error("invalid task kind"), {
						status: 400,
						code: "invalid_task_kind",
						details: { vendor: "veo", kind: requestForVendor.kind },
					});
				}
				result = await runVeoVideoTask(c, userId, requestForVendor);
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
				if (requestForVendor.kind !== "text_to_video") {
					throw Object.assign(new Error("invalid task kind"), {
						status: 400,
						code: "invalid_task_kind",
						details: { vendor: "minimax", kind: requestForVendor.kind },
					});
				}
				result = await runMiniMaxVideoTask(c, userId, requestForVendor);
				const nowIso = new Date().toISOString();
				await upsertVendorTaskRef(
					c.env.DB,
					userId,
					{ kind: "video", taskId: result.id, vendor: "minimax" },
					nowIso,
				);
			} else if (v === "sora2api") {
				if (requestForVendor.kind !== "text_to_video") {
					// sora2api image tasks are handled by generic runner
					result = await runGenericTaskForVendor(c, userId, v, requestForVendor);
				} else {
					result = await runSora2ApiVideoTask(c, userId, requestForVendor);
				}
				// sora2api runner persists vendor refs internally when needed.
			} else {
				result = await runGenericTaskForVendor(c, userId, v, requestForVendor);
			}

			// For public endpoints, a failed TaskResult should trigger vendor fallback
			// (e.g. missing token / upstream transient issues).
			if (result?.status === "failed") {
				setTraceStage(c, "public:vendor:task_failed", {
					taskKind: request?.kind ?? null,
					vendor: v || null,
					resultStatus: "failed",
				});
				lastFailed = { vendor: v, result };
				continue;
			}

			// dmxapi: sync image response still needs to follow "taskId -> poll result" contract.
			if (
				v === "dmxapi" &&
				(requestForVendor.kind === "text_to_image" ||
					requestForVendor.kind === "image_edit") &&
				result?.status === "succeeded" &&
				Array.isArray(result?.assets) &&
				result.assets.length > 0
			) {
				const nowIso = new Date().toISOString();
				const storedTaskId = `task_${crypto.randomUUID()}`;
				const upstreamTaskId =
					typeof result?.id === "string"
						? result.id.trim()
						: String(result?.id || "").trim();

				// Persist final result for /public/tasks/result and /tasks/result.
				try {
					const finalResult = {
						id: storedTaskId,
						kind: result.kind,
						status: "succeeded",
						assets: result.assets,
						raw: {
							provider: "task_store",
							vendor: v,
							upstreamTaskId: upstreamTaskId || null,
							storedAt: nowIso,
						},
					};
					await upsertTaskResult(c.env.DB, {
						userId,
						taskId: storedTaskId,
						vendor: v,
						kind: String(result.kind),
						status: "succeeded",
						result: finalResult,
						completedAt: nowIso,
						nowIso,
					});
					await upsertVendorTaskRef(
						c.env.DB,
						userId,
						{
							kind: "image",
							taskId: storedTaskId,
							vendor: v,
							pid: upstreamTaskId || null,
						},
						nowIso,
					);

					// Return "queued" so callers can poll by taskId for a unified flow.
					result = {
						id: storedTaskId,
						kind: result.kind,
						status: "queued",
						assets: [],
						raw: {
							provider: "task_store",
							vendor: v,
							upstreamTaskId: upstreamTaskId || null,
							storedResultReady: true,
						},
					};
				} catch (err: any) {
					console.warn(
						"[task-store] persist dmxapi result failed",
						err?.message || err,
					);
				}
			}

			// Persist final result so callers can safely poll /public/tasks/result even for sync vendors.
			try {
				const taskId =
					typeof result?.id === "string"
						? result.id.trim()
						: String(result?.id || "").trim();
				const status =
					typeof result?.status === "string" ? result.status.trim() : "";
				const kind =
					typeof result?.kind === "string"
						? result.kind.trim()
						: String(requestForVendor.kind || "").trim();
				if (taskId && kind && (status === "succeeded" || status === "failed")) {
					const nowIso = new Date().toISOString();
					await upsertTaskResult(c.env.DB, {
						userId,
						taskId,
						vendor: v,
						kind,
						status,
						result,
						completedAt: nowIso,
						nowIso,
					});
				}
			} catch (err: any) {
				console.warn(
					"[task-store] persist public result failed",
					err?.message || err,
				);
			}

			return { vendor: v, result };
		} catch (err: any) {
			setTraceStage(c, "public:vendor:error", {
				taskKind: request?.kind ?? null,
				vendorCandidate,
				dispatchVendor: v || null,
				code: typeof err?.code === "string" ? err.code : null,
				status:
					typeof err?.status === "number"
						? err.status
						: Number.isFinite(Number(err?.status))
							? Number(err.status)
							: null,
				message:
					typeof err?.message === "string"
						? err.message.slice(0, 300)
						: String(err).slice(0, 300),
			});
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
							extras: { modelAlias: "veo3.1-fast", durationSeconds: 10 },
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
						extras: { modelAlias: "nano-banana-pro", aspectRatio: "1:1" },
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

	const vendorRaw = (input.vendor || "auto").trim().toLowerCase();
	const dispatchVendor = vendorRaw && vendorRaw !== "auto" ? normalizeDispatchVendor(vendorRaw) : "";
	const preferAsync =
		input.async === true || (input.async !== false && dispatchVendor === "tuzi");

	if (preferAsync) {
		if (!dispatchVendor) {
			return c.json(
				{
					error: "vendor is required for async draw",
					code: "vendor_required",
				},
				400,
			);
		}

		const enabledSystemVendors = await listEnabledSystemVendors(c);
		if (!enabledSystemVendors.has(dispatchVendor)) {
			throw new AppError("该厂商已禁用或未配置（系统级）", {
				status: 400,
				code: "vendor_disabled",
				details: {
					vendorRaw: vendorRaw || null,
					vendor: dispatchVendor,
					systemEnabledVendors: Array.from(enabledSystemVendors.values()),
				},
			});
		}

		// Map modelAlias -> modelKey for this explicit vendor (keeps behavior aligned with fallback runner).
		const extras = (request?.extras || {}) as Record<string, any>;
		const modelAliasRaw =
			typeof extras?.modelAlias === "string" && extras.modelAlias.trim()
				? extras.modelAlias.trim()
				: "";
		const requestForVendor = await (async () => {
			if (!modelAliasRaw) {
				const cleanExtras = { ...(extras || {}) } as Record<string, any>;
				delete (cleanExtras as any).modelAlias;
				return { ...request, extras: cleanExtras };
			}

			const expectedKind = resolveCatalogKindForTaskKind(request?.kind ?? null);
			let mappedModelKey: string | null = null;
			try {
				const rows = await listCatalogModelsByModelAlias(c.env.DB, modelAliasRaw);
				for (const row of rows) {
					if (!row) continue;
					if (Number((row as any).enabled ?? 1) === 0) continue;
					const kindRaw =
						typeof (row as any).kind === "string" ? (row as any).kind.trim() : "";
					if (expectedKind && kindRaw && kindRaw !== expectedKind) continue;
					const vendorKeyRaw =
						typeof (row as any).vendor_key === "string"
							? (row as any).vendor_key.trim()
							: "";
					const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
					if (!vendorKey || vendorKey !== dispatchVendor) continue;
					const mk =
						typeof (row as any).model_key === "string"
							? (row as any).model_key.trim()
							: "";
					if (!mk) continue;
					mappedModelKey = mk;
					break;
				}
			} catch {
				mappedModelKey = null;
			}

			if (!mappedModelKey) {
				throw new AppError(
					"未找到可用的模型别名配置（请在 /stats -> 模型管理（系统级）为该别名配置并启用模型）",
					{
						status: 400,
						code: "model_alias_not_found",
						details: {
							taskKind: request?.kind ?? null,
							vendor: dispatchVendor,
							modelAlias: modelAliasRaw,
						},
					},
				);
			}

			const cleanExtras = { ...(extras || {}) } as Record<string, any>;
			delete (cleanExtras as any).modelAlias;
			cleanExtras.modelKey = mappedModelKey;
			return { ...request, extras: cleanExtras };
		})();

		try {
			// Hint proxy selector: prefer higher-success channels for this task kind.
			if (requestForVendor?.kind) c.set("routingTaskKind", requestForVendor.kind);
		} catch {
			// ignore
		}

		const result = await enqueueStoredTaskForVendor(
			c as any,
			userId,
			dispatchVendor,
			requestForVendor as any,
		);

		return c.json(
			PublicRunTaskResponseSchema.parse({
				vendor: dispatchVendor,
				result,
			}),
			200,
		);
	}

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
		"便捷视频接口：创建 text_to_video 任务（会自动 vendor 回退；可通过 extras.modelAlias 指定模型（推荐；兼容 extras.modelKey））。",
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
						extras: { modelAlias: "veo3.1-fast" },
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

	// 1) Stored result fast-path (e.g. sync vendors like dmxapi)
	try {
		const stored = await getTaskResultByTaskId(c.env.DB, userId, taskId);
		if (stored?.result) {
			const payload = JSON.parse(stored.result);
			return c.json(
				PublicFetchTaskResultResponseSchema.parse({
					vendor: stored.vendor,
					result: payload,
				}),
				200,
			);
		}
	} catch {
		// ignore and fall back to vendor polling
	}

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

	resolved.vendor = resolved.vendor.trim();
	if (!resolved.vendor || resolved.vendor.toLowerCase() === "auto") {
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
		const hint = normalizeProxyVendorHint(raw);
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
	const useGrsaiDrawImagePolling =
		resolved.kind === "image" &&
		shouldUseGrsaiDrawPollingForImageTask(resolved.vendor);
	let result: any;

	if (dispatch === "apimart") {
		result = await fetchApimartTaskResult(c, userId, taskId, prompt, {
			taskKind: (taskKind as any) ?? null,
		});
	} else if (useGrsaiDrawImagePolling) {
		result = await fetchGrsaiDrawTaskResult(c, userId, taskId, {
			taskKind: (taskKind as any) ?? null,
			promptFromClient: prompt,
		});
	} else if (dispatch === "asyncdata") {
		if (resolved.kind === "image") {
			return c.json(
				{
					error: "asyncdata 仅支持视频任务轮询",
					code: "invalid_task_kind",
				},
				400,
			);
		}
		result = await fetchAsyncDataTaskResult(c, userId, taskId, {
			taskKind: (taskKind as any) ?? null,
			promptFromClient: prompt,
		});
	} else if (dispatch === "tuzi") {
		if (resolved.kind === "image") {
			return c.json(
				{
					error:
						"tuzi 图像任务通常为同步返回；如需轮询请携带创建接口返回的 taskId/vendor（或直接使用创建接口返回结果）",
					code: "invalid_task_kind",
				},
				400,
			);
		}
		result = await fetchTuziTaskResult(c, userId, taskId, {
			taskKind: (taskKind as any) ?? null,
			promptFromClient: prompt,
		});
	} else if (resolved.kind === "image") {
		return c.json(
			{
				error: "该图像任务不支持轮询（请使用创建接口返回结果，或选择支持轮询的厂商）",
				code: "polling_not_supported",
			},
			400,
		);
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
