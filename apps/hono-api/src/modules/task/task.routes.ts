import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../../types";
import { AppError } from "../../middleware/error";
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
import { upsertTaskResult } from "./task-result.repo";
import {
	fetchApimartTaskResult,
	fetchGrsaiDrawTaskResult,
	fetchMappedTaskResultForVendor,
	enqueueStoredTaskForVendor,
	runGenericTaskForVendor,
} from "./task.service";
import type { TaskProgressSnapshotDto } from "./task.schemas";
import {
	addTaskProgressSubscriber,
	removeTaskProgressSubscriber,
	type TaskProgressSubscriber,
	getPendingTaskSnapshots,
} from "./task.progress";
import { listVendorCallLogs } from "./vendor-call-logs.repo";
import { fetchTaskResultForPolling } from "./task.polling";
import { maybeWrapSyncImageResultAsStoredTask } from "./task.task-store-wrap";

export const taskRouter = new Hono<AppEnv>();

taskRouter.use("*", authMiddleware);

function isLocalDevRequest(c: any): boolean {
	try {
		const url = new URL(c.req.url);
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
}

function isAdminRequest(c: any): boolean {
	if (isLocalDevRequest(c)) return true;
	const auth = c.get("auth") as { role?: string | null } | undefined;
	return auth?.role === "admin";
}

type FetchTaskResultRequestDto = ReturnType<
	typeof FetchTaskResultRequestSchema.parse
>;

async function parseFetchTaskResultBody(
	c: any,
): Promise<
	| { ok: true; data: FetchTaskResultRequestDto }
	| { ok: false; response: Response }
> {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return {
			ok: false,
			response: c.json(
				{ error: "Invalid request body", issues: parsed.error.issues },
				400,
			),
		};
	}
	return { ok: true, data: parsed.data };
}

function registerVendorResultRoute(
	path: string,
	handler: (
		c: any,
		userId: string,
		body: FetchTaskResultRequestDto,
	) => Promise<unknown>,
) {
	taskRouter.post(path, async (c) => {
		const userId = c.get("userId");
		if (!userId) return c.json({ error: "Unauthorized" }, 401);
		const parsed = await parseFetchTaskResultBody(c);
		if (!parsed.ok) return parsed.response;
		const result = await handler(c, userId, parsed.data);
		return c.json(TaskResultSchema.parse(result));
	});
}

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

	const isGeminiImageTask =
		(vendor === "gemini" || vendor === "google") &&
		(req.kind === "text_to_image" || req.kind === "image_edit");
	const isDreaminaAsyncTask =
		(vendor === "dreamina-cli" || vendor === "dreamina") &&
		(req.kind === "text_to_image" || req.kind === "text_to_video");
	const shouldUseTaskStore = isGeminiImageTask || isDreaminaAsyncTask;
	let result = shouldUseTaskStore
		? await enqueueStoredTaskForVendor(c as any, userId, vendor, req)
		: await runGenericTaskForVendor(c, userId, vendor, req);

	result = await maybeWrapSyncImageResultAsStoredTask(c as any, userId, {
		vendor,
		requestKind: req.kind,
		result: result as any,
	});

	// Persist final result so callers can safely poll /tasks/result even for sync vendors.
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
				: String(req.kind || "").trim();
		if (taskId && kind && (status === "succeeded" || status === "failed")) {
			const nowIso = new Date().toISOString();
			await upsertTaskResult(c.env.DB, {
				userId,
				taskId,
				vendor,
				kind,
				status,
				result,
				completedAt: nowIso,
				nowIso,
			});
		}
	} catch (err: any) {
		console.warn(
			"[task-store] persist task result failed",
			err?.message || err,
		);
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
	const isAdmin = isAdminRequest(c);

	const limitRaw = c.req.query("limit");
	const parsedLimit = Number(limitRaw ?? 50);
	const limit = Number.isFinite(parsedLimit)
		? Math.max(1, Math.min(200, Math.floor(parsedLimit)))
		: 50;

	const queryUserIdRaw = c.req.query("userId");
	const queryUserId =
		typeof queryUserIdRaw === "string" && queryUserIdRaw.trim()
			? queryUserIdRaw.trim()
			: null;
	if (!isAdmin && queryUserId && queryUserId !== userId) {
		return c.json({ error: "Forbidden" }, 403);
	}

	const before = c.req.query("before") || null;
	const vendor = c.req.query("vendor") || null;

	const statusRaw = c.req.query("status") || null;
	const statusParsed = (() => {
		if (!statusRaw) return null;
		const parsed = VendorCallLogStatusSchema.safeParse(statusRaw);
		return parsed.success ? parsed.data : null;
	})();

	const taskKind = c.req.query("taskKind") || null;

	const targetUserId = isAdmin ? queryUserId : userId;

	// Fetch one extra row to detect "hasMore"
	const rows = await listVendorCallLogs(c.env.DB, {
		userId: targetUserId,
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
			taskId:
				typeof r.task_id === "string" && r.task_id.trim()
					? r.task_id
					: typeof r.row_id === "number" && Number.isFinite(r.row_id)
					? `row_${r.row_id}`
					: `missing_${String(r.vendor || "unknown")}_${String(r.created_at || "")}`,
			userId: r.user_id,
			userLogin: r.user_login ?? null,
			userName: r.user_name ?? null,
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
	const parsed = await parseFetchTaskResultBody(c);
	if (!parsed.ok) return parsed.response;

	const outcome = await fetchTaskResultForPolling(c as any, userId, {
		taskId: parsed.data.taskId,
		taskKind: parsed.data.taskKind ?? null,
		prompt: typeof parsed.data.prompt === "string" ? parsed.data.prompt : null,
		mode: "internal",
	});
	if (outcome.ok) return c.json(outcome.result);
	return c.json((outcome as any).body, (outcome as any).status);
});

registerVendorResultRoute("/veo/result", async (c, userId, body) => {
	const result = await fetchMappedTaskResultForVendor(c, userId, "veo", {
		taskId: body.taskId,
		taskKind: (body.taskKind as any) ?? null,
		kindHint: "video",
		promptFromClient: body.prompt ?? null,
	});
	if (result) return result;
	throw new AppError("厂商 veo 未配置可用的视频结果映射（model_catalog_mappings）", {
		status: 400,
		code: "mapping_not_configured",
		details: { vendor: "veo", taskKind: body.taskKind ?? "text_to_video" },
	});
});

registerVendorResultRoute("/apimart/result", (c, userId, body) =>
	fetchApimartTaskResult(c, userId, body.taskId, body.prompt ?? null, {
		taskKind: (body.taskKind as any) ?? null,
	}),
);

registerVendorResultRoute("/grsai/result", (c, userId, body) =>
	fetchGrsaiDrawTaskResult(c, userId, body.taskId, {
		taskKind: body.taskKind ?? null,
		promptFromClient: body.prompt ?? null,
	}),
);

// POST /tasks/gemini/result - alias for Gemini image tasks (Banana/grsai draw result polling)
taskRouter.post("/gemini/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = await parseFetchTaskResultBody(c);
	if (!parsed.ok) return parsed.response;

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
