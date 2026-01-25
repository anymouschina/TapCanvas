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
	fetchSora2ApiTaskResult,
	fetchGrsaiDrawTaskResult,
	fetchMiniMaxTaskResult,
	fetchVeoTaskResult,
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
		result = await runGenericTaskForVendor(c, userId, vendor, req);
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
