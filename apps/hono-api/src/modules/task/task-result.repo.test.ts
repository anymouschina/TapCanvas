import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../types";

const prismaMocks = vi.hoisted(() => {
	type TestTransaction = {
		task_results: {
			create: ReturnType<typeof vi.fn>;
			findUnique: ReturnType<typeof vi.fn>;
			upsert: ReturnType<typeof vi.fn>;
			updateMany: ReturnType<typeof vi.fn>;
		};
		task_statuses: { create: ReturnType<typeof vi.fn> };
		user_notifications: { upsert: ReturnType<typeof vi.fn> };
	};
	const transaction: TestTransaction = {
		task_results: {
			create: vi.fn(),
			findUnique: vi.fn(),
			upsert: vi.fn(),
			updateMany: vi.fn(),
		},
		task_statuses: { create: vi.fn() },
		user_notifications: { upsert: vi.fn() },
	};
	return {
		transaction,
		taskResults: {
			findMany: vi.fn(),
			updateMany: vi.fn(),
		},
		transactionCall: vi.fn(async (
			operation: (client: TestTransaction) => Promise<unknown>,
		) => operation(transaction)),
	};
});

import {
	buildStaleFailResult,
	buildTaskResultNotification,
	createTaskResultWithDurableDispatch,
	upsertTaskResult,
	sweepStaleTaskResults,
} from "./task-result.repo";

function createDbMock(): PrismaClient {
	return {
		$transaction: prismaMocks.transactionCall,
		task_results: prismaMocks.taskResults,
	} as unknown as PrismaClient;
}

beforeEach(() => {
	vi.clearAllMocks();
	prismaMocks.transaction.task_results.findUnique.mockResolvedValue(null);
	prismaMocks.transaction.task_results.updateMany.mockResolvedValue({ count: 1 });
});

describe("task result notification outbox", () => {
	it("builds a deterministic versioned notification fact", () => {
		const notification = buildTaskResultNotification({
			userId: "user-1",
			taskId: "task-1",
			vendor: "newapi",
			kind: "text_to_image",
			status: "succeeded",
			nodeId: "node-1",
			chapterId: null,
			completedAt: "2026-08-14T00:00:00.000Z",
		});
		expect(notification.id).toBe("task-result:user-1:task-1");
		expect(JSON.parse(notification.metadata_json)).toEqual(expect.objectContaining({
			protocolVersion: "tapcanvas.task-notification.v1",
			taskId: "task-1",
			status: "succeeded",
		}));
	});

	it("writes a terminal result and its user notification in one transaction", async () => {
		await upsertTaskResult(createDbMock(), {
			userId: "user-1",
			taskId: "task-1",
			vendor: "newapi",
			kind: "text_to_image",
			status: "succeeded",
			result: { id: "task-1", status: "succeeded", assets: [] },
			completedAt: "2026-08-14T00:00:00.000Z",
			nowIso: "2026-08-14T00:00:00.000Z",
		});

		expect(prismaMocks.transactionCall).toHaveBeenCalledTimes(1);
		expect(prismaMocks.transaction.task_results.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ update: expect.objectContaining({ status: "succeeded" }) }),
		);
		expect(prismaMocks.transaction.user_notifications.upsert).toHaveBeenCalledWith({
			where: { id: "task-result:user-1:task-1" },
			create: expect.objectContaining({ read_at: null, type: "task_result" }),
			update: expect.not.objectContaining({ read_at: expect.anything() }),
		});
	});

	it("rejects a late non-success write after durable success", async () => {
		prismaMocks.transaction.task_results.findUnique.mockResolvedValueOnce({
			status: "succeeded",
			completed_at: "2026-08-14T00:00:00.000Z",
			chapter_id: null,
			node_id: null,
		});

		await expect(upsertTaskResult(createDbMock(), {
			userId: "user-1",
			taskId: "task-1",
			vendor: "newapi",
			kind: "text_to_image",
			status: "failed",
			result: { id: "task-1", status: "failed", assets: [] },
			completedAt: "2026-08-14T00:02:00.000Z",
			nowIso: "2026-08-14T00:02:00.000Z",
		})).rejects.toThrow("task_result_terminal_conflict: succeeded -> failed");

		expect(prismaMocks.transaction.task_results.upsert).not.toHaveBeenCalled();
		expect(prismaMocks.transaction.user_notifications.upsert).not.toHaveBeenCalled();
	});

	it("allows real success evidence to supersede an earlier failed projection", async () => {
		prismaMocks.transaction.task_results.findUnique.mockResolvedValueOnce({
			status: "failed",
			completed_at: "2026-08-14T00:00:00.000Z",
			chapter_id: null,
			node_id: null,
		});

		await upsertTaskResult(createDbMock(), {
			userId: "user-1",
			taskId: "task-1",
			vendor: "newapi",
			kind: "text_to_image",
			status: "succeeded",
			result: { id: "task-1", status: "succeeded", assets: [{ type: "image", url: "https://assets.example.com/a.png" }] },
			completedAt: "2026-08-14T00:03:00.000Z",
			nowIso: "2026-08-14T00:03:00.000Z",
		});

		expect(prismaMocks.transaction.task_results.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				update: expect.objectContaining({
					status: "succeeded",
					completed_at: "2026-08-14T00:03:00.000Z",
				}),
			}),
		);
	});
});

describe("buildStaleFailResult", () => {
	it("在原 result 上盖 failed 终态 + stale 标注，保留原字段", () => {
		const raw = JSON.stringify({
			id: "task_x",
			kind: "image_to_video",
			status: "running",
			raw: { provider: "new_api", upstreamTaskId: "task_x" },
		});
		const out = JSON.parse(buildStaleFailResult(raw, "stale_timeout_15m"));
		expect(out.status).toBe("failed");
		expect(out.staleTimeout).toBe(true);
		expect(out.failReason).toBe("stale_timeout_15m");
		// 原始字段保留便于追溯
		expect(out.id).toBe("task_x");
		expect(out.kind).toBe("image_to_video");
		expect(out.raw.upstreamTaskId).toBe("task_x");
	});

	it("原 result 为非法 JSON → 丢弃，只写终态", () => {
		const out = JSON.parse(buildStaleFailResult("{not-valid", "stale_timeout_15m"));
		expect(out).toEqual({ status: "failed", staleTimeout: true, failReason: "stale_timeout_15m" });
	});

	it("原 result 为 null → 只写终态", () => {
		const out = JSON.parse(buildStaleFailResult(null, "stale_timeout"));
		expect(out.status).toBe("failed");
		expect(out.staleTimeout).toBe(true);
	});

	it("原 result 为数组(非对象) → 不并入，只写终态", () => {
		const out = JSON.parse(buildStaleFailResult(JSON.stringify([1, 2, 3]), "x"));
		expect(out).toEqual({ status: "failed", staleTimeout: true, failReason: "x" });
	});
});

describe("createTaskResultWithDurableDispatch", () => {
	it("writes the visible task and waiting outbox in one database transaction", async () => {
		await createTaskResultWithDurableDispatch(createDbMock(), {
			result: {
				userId: "user-1",
				taskId: "task-1",
				vendor: "newapi",
				kind: "text_to_image",
				status: "queued",
				result: { id: "task-1", kind: "text_to_image", status: "queued", assets: [] },
				nowIso: "2026-08-14T00:00:00.000Z",
			},
			dispatch: {
				provider: "async_image_dispatch",
				status: "waiting",
				data: { version: 1, taskId: "task-1" },
			},
		});

		expect(prismaMocks.transactionCall).toHaveBeenCalledTimes(1);
		expect(prismaMocks.transaction.task_results.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ task_id: "task-1", status: "queued" }),
		});
		expect(prismaMocks.transaction.task_statuses.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				task_id: "task-1",
				provider: "async_image_dispatch",
				status: "waiting",
			}),
		});
	});
});

describe("sweepStaleTaskResults", () => {
	it("uses the caller database and atomically closes only stale non-terminal rows", async () => {
		prismaMocks.taskResults.findMany.mockResolvedValueOnce([
			{
				user_id: "user-1",
				task_id: "task-stale",
				kind: "text_to_image",
				result: JSON.stringify({ id: "task-stale", status: "running" }),
				updated_at: "2026-08-14T00:00:00.000Z",
			},
		]);
		prismaMocks.transaction.task_results.findUnique.mockResolvedValueOnce({
			vendor: "newapi",
			kind: "text_to_image",
			node_id: null,
			chapter_id: null,
		});

		const result = await sweepStaleTaskResults(createDbMock(), {
			staleMs: 60_000,
			nowMs: Date.parse("2026-08-14T00:02:00.000Z"),
		});

		expect(result).toEqual({ scanned: 1, failed: 1 });
		expect(prismaMocks.taskResults.findMany).toHaveBeenCalledTimes(1);
		expect(prismaMocks.transaction.task_results.updateMany).toHaveBeenCalledWith({
			where: {
				user_id: "user-1",
				task_id: "task-stale",
				status: { in: ["queued", "claimed", "running"] },
			},
			data: expect.objectContaining({
				status: "failed",
				completed_at: "2026-08-14T00:02:00.000Z",
			}),
		});
		expect(prismaMocks.transaction.user_notifications.upsert).toHaveBeenCalledTimes(1);
	});
});
