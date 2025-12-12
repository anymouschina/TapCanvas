import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	RunTaskRequestSchema,
	TaskResultSchema,
	TaskProgressSnapshotSchema,
	FetchTaskResultRequestSchema,
} from "./task.schemas";
import {
	fetchSora2ApiTaskResult,
	fetchVeoTaskResult,
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

		let notify: (() => void) | null = null;
		const waitForEvent = () =>
			new Promise<void>((resolve) => {
				notify = resolve;
			});

		const subscriber: TaskProgressSubscriber = {
			push(event) {
				if (closed) return;
				queue.push(event);
				if (notify) {
					notify();
					notify = null;
				}
			},
		};

		addTaskProgressSubscriber(userId, subscriber);

		const abortSignal = c.req.raw.signal as AbortSignal;
		abortSignal.addEventListener("abort", () => {
			closed = true;
			if (notify) {
				notify();
				notify = null;
			}
		});

		try {
			await stream.writeSSE({
				data: JSON.stringify({ type: "init" }),
			});

			while (!closed) {
				if (!queue.length) {
					await waitForEvent();
				}
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
