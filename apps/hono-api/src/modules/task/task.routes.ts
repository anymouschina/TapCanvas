import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	RunTaskRequestSchema,
	TaskResultSchema,
	TaskProgressSnapshotSchema,
	FetchTaskResultRequestSchema,
	VendorCallLogListResponseSchema,
	VendorCallLogStatusSchema,
	VendorCallLogSchema,
} from "./task.schemas";
import {
	fetchApimartTaskResult,
	fetchAsyncDataTaskResult,
	fetchTuziTaskResult,
	fetchSora2ApiTaskResult,
	fetchGrsaiDrawTaskResult,
	fetchMiniMaxTaskResult,
	fetchVeoTaskResult,
	runApimartTextTask,
	runApimartVideoTask,
	runApimartImageTask,
	enqueueStoredTaskForVendor,
	runMiniMaxVideoTask,
	runSora2ApiVideoTask,
	runVeoVideoTask,
	runGenericTaskForVendor,
} from "./task.service";
import type { TaskProgressSnapshotDto } from "./task.schemas";
import {
	addTaskProgressSubscriber,
	removeTaskProgressSubscriber,
	type TaskProgressSubscriber,
	getPendingTaskSnapshots,
} from "./task.progress";
import { listVendorCallLogsForUser } from "./vendor-call-logs.repo";
import { getTaskResultByTaskId, upsertTaskResult } from "./task-result.repo";
import { getVendorTaskRefByTaskId, upsertVendorTaskRef } from "./vendor-task-refs.repo";

function normalizeDispatchVendor(vendor: string): string {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return "";
	const parts = raw.split(":").map((p) => p.trim()).filter(Boolean);
	const last = parts.length ? parts[parts.length - 1]! : raw;
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
	if (raw === "gemini" || raw === "google") return true;
	if (raw === "grsai" || raw.startsWith("grsai-") || raw.startsWith("grsai:")) return true;
	if (raw === "comfly" || raw.startsWith("comfly-") || raw.startsWith("comfly:")) return true;
	if (raw.startsWith("apimart-") || raw.startsWith("apimart:")) return true;
	return false;
}

export const taskRouter = new Hono<AppEnv>();

taskRouter.use("*", authMiddleware);

// POST /tasks - unified vendor-based tasks
taskRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RunTaskRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const payload = parsed.data;

	// profileId-based执行（按模型预设）暂未在 Worker 中实现
	if ("profileId" in payload) {
		return c.json(
			{
				error:
					"profile-based tasks are not yet supported in Worker backend",
				code: "profile_tasks_not_implemented",
			},
			400,
		);
	}

	const vendor = payload.vendor.trim().toLowerCase();
	const req = payload.request;

	let result;
	if (vendor === "veo") {
		if (req.kind !== "text_to_video") {
			return c.json(
				{
					error: "veo only supports text_to_video tasks",
					code: "invalid_task_kind",
				},
				400,
			);
		}
		result = await runVeoVideoTask(c, userId, req);
	} else if (vendor === "apimart") {
		if (req.kind === "text_to_video") {
			result = await runApimartVideoTask(c, userId, req);
		} else if (req.kind === "text_to_image" || req.kind === "image_edit") {
			result = await runApimartImageTask(c, userId, req);
		} else if (req.kind === "chat" || req.kind === "prompt_refine") {
			result = await runApimartTextTask(c, userId, req);
		} else {
			return c.json(
				{
					error: "apimart only supports chat/prompt_refine/text_to_video/text_to_image/image_edit tasks",
					code: "invalid_task_kind",
				},
				400,
			);
		}
	} else if (vendor === "minimax") {
		if (req.kind !== "text_to_video") {
			return c.json(
				{
					error: "minimax only supports text_to_video tasks",
					code: "invalid_task_kind",
				},
				400,
			);
		}
		result = await runMiniMaxVideoTask(c, userId, req);
	} else if (vendor === "sora2api") {
		if (req.kind === "text_to_video") {
			result = await runSora2ApiVideoTask(c, userId, req);
		} else if (req.kind === "text_to_image" || req.kind === "image_edit") {
			// sora2api image tasks are handled by generic runner (chat/completions proxy)
			result = await runGenericTaskForVendor(c, userId, vendor, req);
		} else {
			return c.json(
				{
					error: "sora2api only supports text_to_video/text_to_image/image_edit tasks",
					code: "invalid_task_kind",
				},
				400,
			);
		}
	} else {
		const shouldUseTaskStore =
			(vendor === "gemini" || vendor === "google") &&
			(req.kind === "text_to_image" || req.kind === "image_edit");
		result = shouldUseTaskStore
			? await enqueueStoredTaskForVendor(c as any, userId, vendor, req)
			: await runGenericTaskForVendor(c, userId, vendor, req);
	}

	// dmxapi: sync image response still needs to follow "taskId -> poll result" contract.
	if (
		vendor === "dmxapi" &&
		(req.kind === "text_to_image" || req.kind === "image_edit") &&
		result?.status === "succeeded" &&
		Array.isArray((result as any)?.assets) &&
		(result as any).assets.length > 0
	) {
		const nowIso = new Date().toISOString();
		const storedTaskId = `task_${crypto.randomUUID()}`;
		const upstreamTaskId =
			typeof (result as any)?.id === "string"
				? String((result as any).id).trim()
				: String((result as any)?.id || "").trim();

		try {
			const finalResult = {
				id: storedTaskId,
				kind: (result as any).kind,
				status: "succeeded",
				assets: (result as any).assets,
				raw: {
					provider: "task_store",
					vendor,
					upstreamTaskId: upstreamTaskId || null,
					storedAt: nowIso,
				},
			};
			await upsertTaskResult(c.env.DB, {
				userId,
				taskId: storedTaskId,
				vendor,
				kind: String((result as any).kind),
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
					vendor,
					pid: upstreamTaskId || null,
				},
				nowIso,
			);

			result = {
				id: storedTaskId,
				kind: (result as any).kind,
				status: "queued",
				assets: [],
				raw: {
					provider: "task_store",
					vendor,
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

	return c.json(TaskResultSchema.parse(result));
});

// GET /tasks/stream - minimal SSE stream for task progress
taskRouter.get("/stream", (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	return streamSSE(c, async (stream) => {
		const HEARTBEAT_MS = 15_000;
		const POLL_MS = 250;
		const queue: TaskProgressSnapshotDto[] = [];
		let closed = false;

		const drainQueue = async () => {
			while (queue.length && !closed) {
				const event = queue.shift()!;
				await stream.writeSSE({
					data: JSON.stringify(event),
				});
			}
		};

		const subscriber: TaskProgressSubscriber = {
			push(event) {
				if (closed) return;
				queue.push(event);
			},
		};

		addTaskProgressSubscriber(userId, subscriber);

		const abortSignal = c.req.raw.signal as AbortSignal;
		abortSignal.addEventListener("abort", () => {
			closed = true;
		});

		try {
			let lastHeartbeatAt = Date.now();
			await stream.writeSSE({
				data: JSON.stringify({ type: "init" }),
			});

			while (!closed) {
				if (queue.length) {
					await drainQueue();
					continue;
				}

				const now = Date.now();
				if (now - lastHeartbeatAt >= HEARTBEAT_MS) {
					await stream.writeSSE({
						event: "ping",
						data: JSON.stringify({ type: "ping" }),
					});
					lastHeartbeatAt = now;
					continue;
				}

				await new Promise<void>((resolve) =>
					setTimeout(resolve, POLL_MS),
				);
				await drainQueue();
			}
		} finally {
			closed = true;
			removeTaskProgressSubscriber(userId, subscriber);
		}
	});
});

// GET /tasks/pending - placeholder implementation for now
taskRouter.get("/pending", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const vendor = c.req.query("vendor") || undefined;
	const items = getPendingTaskSnapshots(userId, vendor);
	return c.json(
		items.map((x) => TaskProgressSnapshotSchema.parse(x)),
	);
});

// GET /tasks/logs - per-user generation logs (vendor_api_call_logs)
taskRouter.get("/logs", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const limitRaw = c.req.query("limit");
	const parsedLimit = Number(limitRaw ?? 50);
	const limit = Number.isFinite(parsedLimit)
		? Math.max(1, Math.min(200, Math.floor(parsedLimit)))
		: 50;

	const before = c.req.query("before") || null;
	const vendor = c.req.query("vendor") || null;

	const statusRaw = c.req.query("status") || null;
	const statusParsed = (() => {
		if (!statusRaw) return null;
		const parsed = VendorCallLogStatusSchema.safeParse(statusRaw);
		return parsed.success ? parsed.data : null;
	})();

	const taskKind = c.req.query("taskKind") || null;

	// Fetch one extra row to detect "hasMore"
	const rows = await listVendorCallLogsForUser(c.env.DB, userId, {
		limit: limit + 1,
		before,
		vendor,
		status: statusParsed,
		taskKind,
	});

	const hasMore = rows.length > limit;
	const sliced = hasMore ? rows.slice(0, limit) : rows;
	const items = sliced.map((r) =>
		VendorCallLogSchema.parse({
			vendor: r.vendor,
			taskId: r.task_id,
			taskKind: r.task_kind ?? null,
			status: r.status,
			startedAt: r.started_at ?? null,
			finishedAt: r.finished_at ?? null,
			durationMs:
				typeof r.duration_ms === "number" && Number.isFinite(r.duration_ms)
					? Math.round(r.duration_ms)
					: null,
			errorMessage: r.error_message ?? null,
			requestPayload:
				typeof r.request_json === "string" ? r.request_json : null,
			upstreamResponse:
				typeof r.response_json === "string" ? r.response_json : null,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}),
	);

	const nextBefore =
		items.length > 0 ? items[items.length - 1]!.createdAt : null;

	return c.json(
		VendorCallLogListResponseSchema.parse({
			items,
			hasMore,
			nextBefore,
		}),
	);
});

// POST /tasks/result - unified task polling endpoint (prefers stored results)
taskRouter.post("/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const taskId = parsed.data.taskId.trim();
	const taskKind = parsed.data.taskKind ?? null;
	const prompt = typeof parsed.data.prompt === "string" ? parsed.data.prompt : null;

	// 1) Stored result fast-path (e.g. sync vendors like dmxapi)
	try {
		const stored = await getTaskResultByTaskId(c.env.DB, userId, taskId);
		if (stored?.result) {
			const payload = JSON.parse(stored.result);
			return c.json(TaskResultSchema.parse(payload));
		}
	} catch {
		// ignore and fall back to vendor polling
	}

	const resolveRefKind = (): "video" | "image" | null => {
		if (taskKind === "text_to_video" || taskKind === "image_to_video") return "video";
		if (taskKind === "text_to_image" || taskKind === "image_edit") return "image";
		return null;
	};

	const resolved: {
		vendor: string;
		kind: "video" | "image" | null;
	} = { vendor: "", kind: resolveRefKind() };

	// 2) Infer vendor via vendor_task_refs (same strategy as public polling)
	try {
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
	} catch {
		// ignore
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
						"tuzi 图像任务通常为同步返回；请直接使用创建接口返回结果",
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

	return c.json(TaskResultSchema.parse(result));
});

taskRouter.post("/veo/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await fetchVeoTaskResult(c, userId, parsed.data.taskId);
	return c.json(TaskResultSchema.parse(result));
});

taskRouter.post("/apimart/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await fetchApimartTaskResult(
		c,
		userId,
		parsed.data.taskId,
		parsed.data.prompt ?? null,
		{ taskKind: (parsed.data.taskKind as any) ?? null },
	);
	return c.json(TaskResultSchema.parse(result));
});

taskRouter.post("/sora2api/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await fetchSora2ApiTaskResult(
		c,
		userId,
		parsed.data.taskId,
		parsed.data.prompt ?? null,
	);
	return c.json(TaskResultSchema.parse(result));
});

taskRouter.post("/minimax/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await fetchMiniMaxTaskResult(
		c,
		userId,
		parsed.data.taskId,
	);
	return c.json(TaskResultSchema.parse(result));
});

taskRouter.post("/grsai/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await fetchGrsaiDrawTaskResult(c, userId, parsed.data.taskId, {
		taskKind: parsed.data.taskKind ?? null,
		promptFromClient: parsed.data.prompt ?? null,
	});
	return c.json(TaskResultSchema.parse(result));
});

// POST /tasks/gemini/result - alias for Gemini image tasks (Banana/grsai draw result polling)
taskRouter.post("/gemini/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const taskKind = parsed.data.taskKind ?? null;
	if (taskKind && taskKind !== "text_to_image" && taskKind !== "image_edit") {
		return c.json(
			{
				error: "gemini result endpoint only supports text_to_image/image_edit polling",
				code: "invalid_task_kind",
			},
			400,
		);
	}

	const result = await fetchGrsaiDrawTaskResult(c, userId, parsed.data.taskId, {
		taskKind: taskKind ?? null,
		promptFromClient: parsed.data.prompt ?? null,
	});
	return c.json(TaskResultSchema.parse(result));
});
