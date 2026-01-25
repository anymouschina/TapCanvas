import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { apiKeyAuthMiddleware } from "./apiKey.middleware";
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
	fetchGrsaiDrawTaskResult,
	fetchMiniMaxTaskResult,
	fetchSora2ApiTaskResult,
	fetchVeoTaskResult,
	runGenericTaskForVendor,
	runMiniMaxVideoTask,
	runSora2ApiVideoTask,
	runVeoVideoTask,
} from "../task/task.service";
import { upsertVendorTaskRef, getVendorTaskRefByTaskId } from "../task/vendor-task-refs.repo";

export const apiKeyRouter = new Hono<AppEnv>();
export const publicApiRouter = new Hono<AppEnv>();

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

publicApiRouter.use("*", apiKeyAuthMiddleware);

publicApiRouter.post("/chat", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PublicChatRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const vendor = (parsed.data.vendor || "openai").trim().toLowerCase();
	const prompt = parsed.data.prompt;
	const systemPrompt =
		(typeof parsed.data.systemPrompt === "string" &&
			parsed.data.systemPrompt.trim()) ||
		"请用中文回答。";

	const req = {
		kind: "chat" as const,
		prompt,
		extras: {
			systemPrompt,
			...(typeof parsed.data.modelKey === "string" &&
			parsed.data.modelKey.trim()
				? { modelKey: parsed.data.modelKey.trim() }
				: {}),
			...(typeof parsed.data.temperature === "number"
				? { temperature: parsed.data.temperature }
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
	);
});

function pickAutoVendorsForKind(kind: string, extras?: Record<string, any> | null): string[] {
	const k = (kind || "").trim();
	if (k === "text_to_image" || k === "image_edit") {
		// Prefer Banana (gemini) first; fallback to sora2api then qwen.
		return ["gemini", "sora2api", "qwen"];
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

async function runPublicTaskWithFallback(
	c: any,
	userId: string,
	input: any,
): Promise<{ vendor: string; result: any }> {
	const request = input.request;
	const extras = (request?.extras || {}) as Record<string, any>;

	// Hint proxy selector: prefer higher-success channels for this task kind.
	if (request?.kind) c.set("routingTaskKind", request.kind);

	const vendorRaw = (input.vendor || "auto").trim().toLowerCase();
	const vendorCandidates =
		vendorRaw && vendorRaw !== "auto"
			? [vendorRaw]
			: pickAutoVendorsForKind(request.kind, extras);

	if (!vendorCandidates.length) {
		return Promise.reject(
			Object.assign(new Error("unsupported task kind"), {
				code: "unsupported_task_kind",
				details: { kind: request?.kind },
			}),
		);
	}

	let lastErr: any = null;
	for (const vendorCandidate of vendorCandidates) {
		const v = normalizeDispatchVendor(vendorCandidate);
		try {
			let result: any;
			if (v === "veo") {
				if (request.kind !== "text_to_video") {
					throw Object.assign(new Error("invalid task kind"), {
						code: "invalid_task_kind",
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
						code: "invalid_task_kind",
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

			return { vendor: v, result };
		} catch (err: any) {
			lastErr = err;
			continue;
		}
	}

	throw lastErr || new Error("run public task failed");
}

// Unified public task API: supports image/video/chat via API key.
publicApiRouter.post("/tasks", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PublicRunTaskRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	try {
		const { vendor, result } = await runPublicTaskWithFallback(
			c,
			userId,
			parsed.data,
		);
		return c.json(
			PublicRunTaskResponseSchema.parse({
				vendor,
				result,
			}),
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
publicApiRouter.post("/draw", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PublicDrawRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const request = {
		kind: parsed.data.kind || "text_to_image",
		prompt: parsed.data.prompt,
		...(typeof parsed.data.negativePrompt === "string"
			? { negativePrompt: parsed.data.negativePrompt }
			: {}),
		...(typeof parsed.data.seed === "number" ? { seed: parsed.data.seed } : {}),
		...(typeof parsed.data.width === "number" ? { width: parsed.data.width } : {}),
		...(typeof parsed.data.height === "number"
			? { height: parsed.data.height }
			: {}),
		...(typeof parsed.data.steps === "number" ? { steps: parsed.data.steps } : {}),
		...(typeof parsed.data.cfgScale === "number"
			? { cfgScale: parsed.data.cfgScale }
			: {}),
		...(parsed.data.extras ? { extras: parsed.data.extras } : {}),
	};

	const { vendor, result } = await runPublicTaskWithFallback(c, userId, {
		vendor: parsed.data.vendor,
		request,
	});

	return c.json(
		PublicRunTaskResponseSchema.parse({
			vendor,
			result,
		}),
	);
});

publicApiRouter.post("/video", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PublicVideoRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const extras: Record<string, any> = parsed.data.extras ? { ...parsed.data.extras } : {};
	if (typeof parsed.data.durationSeconds === "number") {
		extras.durationSeconds = parsed.data.durationSeconds;
	}

	const request = {
		kind: "text_to_video",
		prompt: parsed.data.prompt,
		extras,
	};

	const { vendor, result } = await runPublicTaskWithFallback(c, userId, {
		vendor: parsed.data.vendor,
		request,
	});

	return c.json(
		PublicRunTaskResponseSchema.parse({
			vendor,
			result,
		}),
	);
});

// Unified public polling API: resolve vendor via vendor_task_refs when possible.
publicApiRouter.post("/tasks/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PublicFetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const taskId = parsed.data.taskId.trim();
	const vendorInput = (parsed.data.vendor || "").trim();
	const taskKind = parsed.data.taskKind ?? null;
	const prompt = typeof parsed.data.prompt === "string" ? parsed.data.prompt : null;

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

	if (resolved.kind === "image") {
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
	);
});
