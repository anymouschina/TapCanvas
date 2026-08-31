import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const {
	mockedGetTaskResultByTaskId,
	mockedUpsertTaskResult,
	mockedGetVendorTaskRefByTaskId,
	mockedFetchNewApiTaskResult,
	mockedHostTaskAssetsSynchronously,
	mockedGetSharedRedis,
	mockedRecordVendorCallLogFromTaskResult,
} = vi.hoisted(() => ({
	mockedGetTaskResultByTaskId: vi.fn(),
	mockedUpsertTaskResult: vi.fn(),
	mockedGetVendorTaskRefByTaskId: vi.fn(),
	mockedFetchNewApiTaskResult: vi.fn(),
	mockedHostTaskAssetsSynchronously: vi.fn(),
	mockedGetSharedRedis: vi.fn(),
	mockedRecordVendorCallLogFromTaskResult: vi.fn(),
}));

vi.mock("../../platform/redis-shared", () => ({
	getSharedRedis: mockedGetSharedRedis,
}));

vi.mock("./task-result.repo", () => ({
	getTaskResultByTaskId: mockedGetTaskResultByTaskId,
	upsertTaskResult: mockedUpsertTaskResult,
}));

vi.mock("./vendor-task-refs.repo", () => ({
	getVendorTaskRefByTaskId: mockedGetVendorTaskRefByTaskId,
}));

vi.mock("./task.service", () => ({
	fetchNewApiTaskResult: mockedFetchNewApiTaskResult,
	hostTaskAssetsSynchronously: mockedHostTaskAssetsSynchronously,
}));

vi.mock("./task.vendor-call-utils", () => ({
	recordVendorCallLogFromTaskResult: mockedRecordVendorCallLogFromTaskResult,
}));

import {
	STORED_TERMINAL_ASSET_RECOVERY_WINDOW_MS,
	fetchTaskResultForPolling,
	isPermanentUpstreamTaskError,
	resolveStoredTerminalAction,
} from "./task.polling";

function createMockContext(): AppContext {
	const store = new Map<string, unknown>();
	return {
		env: { DB: {} },
		get: (key: string) => store.get(key),
		set: (key: string, value: unknown) => {
			store.set(key, value);
		},
	} as unknown as AppContext;
}

describe("fetchTaskResultForPolling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedGetSharedRedis.mockReturnValue(null);
		mockedRecordVendorCallLogFromTaskResult.mockResolvedValue(undefined);
		mockedHostTaskAssetsSynchronously.mockImplementation(async (input: { result: unknown }) => input.result);
	});

	// fd77b558f(2026-05-29) 起 task_store 管理的 running 行短路返回、不再打上游；
	// 本测试此前仍断言继续轮询，红了 7 周无人发现（vitest 不在门禁）——按现行语义修正。
	it("short-circuits running task_store results without new-api polling", async () => {
		const c = createMockContext();
		mockedGetTaskResultByTaskId.mockResolvedValueOnce({
			vendor: "newapi:yunwu",
			result: JSON.stringify({
				id: "task-1",
				kind: "text_to_video",
				status: "running",
				assets: [],
				raw: {
					provider: "task_store",
					vendor: "yunwu",
				},
			}),
		});

		const outcome = await fetchTaskResultForPolling(c, "user-1", {
			taskId: "task-1",
			taskKind: "text_to_video",
			mode: "internal",
		});

		expect(mockedFetchNewApiTaskResult).not.toHaveBeenCalled();
		expect(outcome).toMatchObject({
			ok: true,
			vendor: "newapi:yunwu",
			result: {
				id: "task-1",
				status: "running",
			},
		});
	});

	// 九天僵尸轮询根治（2026-07-17 复盘实证 task_k694/task_zh8Axb）：
	// 存储行 succeeded+assets空 的托管吞资产自愈绕过只在恢复窗口内有效；
	// 超窗后返回存储终态并带 storedStale 标记，供 reconcile 终态化节点，不再无限打上游 400。
	it("returns aged asset-less succeeded video from store with storedStale instead of polling upstream", async () => {
		const c = createMockContext();
		mockedGetTaskResultByTaskId.mockResolvedValueOnce({
			vendor: "newapi",
			completed_at: "2026-07-08T13:53:00.139Z",
			result: JSON.stringify({
				id: "task-zombie",
				kind: "text_to_video",
				status: "succeeded",
				assets: [],
				raw: {},
			}),
		});

		const outcome = await fetchTaskResultForPolling(c, "user-1", {
			taskId: "task-zombie",
			taskKind: "text_to_video",
			mode: "internal",
		});

		expect(mockedFetchNewApiTaskResult).not.toHaveBeenCalled();
		expect(outcome).toMatchObject({
			ok: true,
			storedStale: true,
			result: { id: "task-zombie", status: "succeeded" },
		});
	});

	it("still bypasses to upstream for recent asset-less succeeded video (托管吞资产自愈保留)", async () => {
		const c = createMockContext();
		mockedGetTaskResultByTaskId.mockResolvedValueOnce({
			vendor: "newapi",
			completed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
			result: JSON.stringify({
				id: "task-fresh",
				kind: "text_to_video",
				status: "succeeded",
				assets: [],
				raw: {},
			}),
		});
		mockedFetchNewApiTaskResult.mockResolvedValueOnce({
			id: "task-fresh",
			kind: "text_to_video",
			status: "succeeded",
			assets: [{ type: "video", url: "https://example.com/result.mp4" }],
			raw: {},
		});

		const outcome = await fetchTaskResultForPolling(c, "user-1", {
			taskId: "task-fresh",
			taskKind: "text_to_video",
			mode: "internal",
		});

		expect(mockedFetchNewApiTaskResult).toHaveBeenCalledTimes(1);
		expect(outcome).toMatchObject({
			ok: true,
			result: { id: "task-fresh", status: "succeeded" },
		});
		expect((outcome as { storedStale?: boolean }).storedStale).toBeUndefined();
		expect(mockedRecordVendorCallLogFromTaskResult).toHaveBeenCalledWith(
			c,
			expect.objectContaining({
				userId: "user-1",
				vendor: "newapi",
				taskKind: "text_to_video",
				result: expect.objectContaining({ id: "task-fresh", status: "succeeded" }),
			}),
		);
	});

	it("leases one upstream poll so concurrent reconcilers cannot host the same video twice", async () => {
		const c = createMockContext();
		mockedGetTaskResultByTaskId.mockResolvedValue(null);
		let resolveUpstream!: (value: Record<string, unknown>) => void;
		mockedFetchNewApiTaskResult.mockImplementationOnce(
			() => new Promise<Record<string, unknown>>((resolve) => {
				resolveUpstream = resolve;
			}),
		);

		const first = fetchTaskResultForPolling(c, "user-lease", {
			taskId: "task-lease",
			taskKind: "image_to_video",
			mode: "internal",
		});
		await Promise.resolve();
		const second = await fetchTaskResultForPolling(c, "user-lease", {
			taskId: "task-lease",
			taskKind: "image_to_video",
			mode: "internal",
		});

		expect(second).toEqual({
			ok: false,
			status: 409,
			body: {
				error: "task polling is already in progress",
				code: "task_poll_in_progress",
			},
		});
		expect(mockedFetchNewApiTaskResult).toHaveBeenCalledTimes(1);
		resolveUpstream({
			id: "task-lease",
			kind: "image_to_video",
			status: "running",
			assets: [],
			raw: {},
		});
		await expect(first).resolves.toMatchObject({
			ok: true,
			result: { id: "task-lease", status: "running" },
		});
	});

	it("fails explicitly when the configured cross-replica lease backend is unavailable", async () => {
		const c = createMockContext();
		mockedGetTaskResultByTaskId.mockResolvedValue(null);
		mockedGetVendorTaskRefByTaskId.mockResolvedValue({
			vendor: "newapi",
			taskKind: "image_to_video",
		});
		mockedGetSharedRedis.mockReturnValue({
			set: vi.fn().mockRejectedValue(new Error("redis unavailable")),
		});

		await expect(
			fetchTaskResultForPolling(c, "user-redis-failure", {
				taskId: "task-redis-failure",
				taskKind: "image_to_video",
				mode: "internal",
			}),
		).rejects.toThrow(
			"task_poll_lease_acquire_failed: Redis lease unavailable for task task-redis-failure: redis unavailable",
		);
		expect(mockedFetchNewApiTaskResult).not.toHaveBeenCalled();
	});
});

describe("isPermanentUpstreamTaskError", () => {
	it("treats 4xx client errors as permanent（与 credit-finalizer 同一判据）", () => {
		for (const status of [400, 403, 404, 422]) {
			expect(isPermanentUpstreamTaskError(status, "whatever")).toBe(true);
		}
	});

	it("treats moderation rejections as permanent regardless of status", () => {
		expect(isPermanentUpstreamTaskError(0, "InputTextSensitiveContentDetected")).toBe(true);
		expect(isPermanentUpstreamTaskError(500, "内容审核不通过")).toBe(true);
	});

	it("treats rate limits and 5xx as transient", () => {
		expect(isPermanentUpstreamTaskError(429, "rate limited")).toBe(false);
		expect(isPermanentUpstreamTaskError(500, "internal error")).toBe(false);
		expect(isPermanentUpstreamTaskError(503, "unavailable")).toBe(false);
		expect(isPermanentUpstreamTaskError(0, "fetch failed")).toBe(false);
	});
});

describe("resolveStoredTerminalAction", () => {
	const nowMs = Date.parse("2026-07-17T08:00:00Z");
	const DAY_MS = 24 * 60 * 60 * 1000;
	const base = {
		status: "succeeded" as const,
		kind: "text_to_video" as const,
		assetsCount: 0,
		storedVendor: "newapi",
	};

	it("recent asset-less succeeded video → bypass upstream", () => {
		expect(
			resolveStoredTerminalAction({
				...base,
				storedCompletedAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
				nowMs,
			}),
		).toBe("bypass_poll_upstream");
	});

	it("aged asset-less succeeded video → return stale", () => {
		expect(
			resolveStoredTerminalAction({
				...base,
				storedCompletedAt: new Date(nowMs - 9 * DAY_MS).toISOString(),
				nowMs,
			}),
		).toBe("return_stored_stale");
	});

	it("terminal result with assets → return as-is even if aged", () => {
		expect(
			resolveStoredTerminalAction({
				...base,
				assetsCount: 2,
				storedCompletedAt: new Date(nowMs - 9 * DAY_MS).toISOString(),
				nowMs,
			}),
		).toBe("return_stored");
	});

	it("non-video kinds never bypass", () => {
		expect(
			resolveStoredTerminalAction({
				...base,
				kind: "text_to_image" as const,
				storedCompletedAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
				nowMs,
			}),
		).toBe("return_stored");
	});

	it("missing completedAt keeps bypass（年龄未知，由 reconcile 永久错终态兜底）", () => {
		expect(
			resolveStoredTerminalAction({ ...base, storedCompletedAt: null, nowMs }),
		).toBe("bypass_poll_upstream");
	});

	it("window boundary: exactly at window → stale", () => {
		expect(
			resolveStoredTerminalAction({
				...base,
				storedCompletedAt: new Date(nowMs - STORED_TERMINAL_ASSET_RECOVERY_WINDOW_MS).toISOString(),
				nowMs,
			}),
		).toBe("return_stored_stale");
	});
});
