import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerEnv } from "../../types";
import type { AsyncImageQueueJob } from "./async-image.queue";

const queueMocks = vi.hoisted(() => ({
	enqueueAsyncImageTask: vi.fn(),
}));

const taskStatusMocks = vi.hoisted(() => ({
	listTaskStatusesByProvider: vi.fn(),
	requeueStaleClaimedTaskStatuses: vi.fn(),
	tryClaimTaskStatus: vi.fn(),
	upsertTaskStatus: vi.fn(),
}));

vi.mock("./async-image.queue", async (importOriginal) => ({
	...(await importOriginal<typeof import("./async-image.queue")>()),
	enqueueAsyncImageTask: queueMocks.enqueueAsyncImageTask,
}));

vi.mock("./task-status.repo", async (importOriginal) => ({
	...(await importOriginal<typeof import("./task-status.repo")>()),
	...taskStatusMocks,
}));

import {
	ASYNC_IMAGE_DISPATCH_PROVIDER,
	buildAsyncImageDispatchContract,
	buildAsyncImageFailedResult,
	buildAsyncImageQueuedResult,
	buildAsyncImageRunningResult,
	buildAsyncImageSucceededResult,
	dispatchAsyncImageTask,
	parseAsyncImageDispatchContractV1,
	sweepAsyncImageDispatches,
} from "./async-image.processor";

function queueJob(overrides: Partial<AsyncImageQueueJob> = {}): AsyncImageQueueJob {
	return {
		taskId: "task-1",
		userId: "user-1",
		request: {
			kind: "text_to_image",
			prompt: "真实小城黄昏",
			extras: { modelKey: "gpt-image-2" },
		},
		activeTeamId: "personal",
		apiKeyBillingTeamId: null,
		apiKeyId: "key-1",
		enqueuedAt: "2026-08-14T00:00:00.000Z",
		...overrides,
	};
}

function queueJobWithGenerationContext(): AsyncImageQueueJob {
	return queueJob({
		request: {
			kind: "text_to_image",
			prompt: "真实小城黄昏",
			extras: {
				modelKey: "gpt-image-2",
				generationContext: {
					projectId: "project-1",
					nodeId: "node-1",
				},
			},
		},
	});
}

function workerEnv(): WorkerEnv {
	return { DB: {} } as WorkerEnv;
}

beforeEach(() => {
	vi.clearAllMocks();
	queueMocks.enqueueAsyncImageTask.mockResolvedValue({
		queueName: "tapcanvas-async-image",
		queueJobId: "queue-job-1",
	});
	taskStatusMocks.tryClaimTaskStatus.mockResolvedValue(true);
	taskStatusMocks.upsertTaskStatus.mockResolvedValue(undefined);
	taskStatusMocks.requeueStaleClaimedTaskStatuses.mockResolvedValue(0);
	taskStatusMocks.listTaskStatusesByProvider.mockResolvedValue([]);
});

describe("async image durable task results", () => {
	it("exposes only the stable task id through queued and running states", () => {
		const job = queueJob();
		expect(buildAsyncImageQueuedResult(job)).toMatchObject({
			id: "task-1",
			status: "queued",
			raw: { provider: "task_store", queueName: "tapcanvas-async-image" },
		});
		expect(buildAsyncImageRunningResult(job, "2026-08-14T00:00:01.000Z")).toMatchObject({
			id: "task-1",
			status: "running",
		});
	});

	it("preserves hosted assets and upstream identity at success", () => {
		const result = buildAsyncImageSucceededResult(
			queueJob(),
			{
				id: "task-1",
				kind: "text_to_image",
				status: "succeeded",
				assets: [{ type: "image", url: "https://assets.example/image.png" }],
				raw: { upstreamTaskId: "provider-task-1" },
			},
			"2026-08-14T00:01:00.000Z",
		);

		expect(result).toMatchObject({
			id: "task-1",
			status: "succeeded",
			assets: [{ url: "https://assets.example/image.png" }],
			raw: { upstreamTaskId: "provider-task-1" },
		});
	});

	it("preserves generation context through queued, running, succeeded, and failed states", () => {
		const job = queueJobWithGenerationContext();
		const expectedRaw = {
			generationContext: {
				projectId: "project-1",
				nodeId: "node-1",
			},
		};

		expect(buildAsyncImageQueuedResult(job).raw).toMatchObject(expectedRaw);
		expect(buildAsyncImageRunningResult(
			job,
			"2026-08-14T00:00:01.000Z",
		).raw).toMatchObject(expectedRaw);
		expect(buildAsyncImageSucceededResult(job, {
			id: "provider-task-1",
			kind: "text_to_image",
			status: "succeeded",
			assets: [{ type: "image", url: "https://assets.example/image.png" }],
			raw: { upstreamTaskId: "provider-task-1" },
		}, "2026-08-14T00:01:00.000Z").raw).toMatchObject(expectedRaw);
		expect(buildAsyncImageFailedResult(
			job,
			new Error("upstream unavailable"),
			"2026-08-14T00:01:00.000Z",
		).raw).toMatchObject(expectedRaw);
	});

	it("rejects a false success without a deliverable asset", () => {
		expect(() => buildAsyncImageSucceededResult(
			queueJob(),
			{
				id: "task-1",
				kind: "text_to_image",
				status: "succeeded",
				assets: [],
				raw: null,
			},
			"2026-08-14T00:01:00.000Z",
		)).toThrow("without deliverable assets");
	});

	it("stores explicit terminal failure evidence", () => {
		const error = Object.assign(new Error("upstream unavailable"), {
			code: "upstream_unavailable",
		});
		expect(buildAsyncImageFailedResult(
			queueJob(),
			error,
			"2026-08-14T00:01:00.000Z",
		)).toMatchObject({
			id: "task-1",
			status: "failed",
			raw: {
				failureReason: "upstream unavailable",
				code: "upstream_unavailable",
			},
		});
	});
});

describe("async image durable dispatch", () => {
	it("round-trips the exact existing queue job through the durable contract", () => {
		const contract = buildAsyncImageDispatchContract(queueJob());
		expect(parseAsyncImageDispatchContractV1(JSON.stringify(contract))).toEqual(contract);
		expect(parseAsyncImageDispatchContractV1({ ...contract, version: 2 })).toBeNull();
	});

	it("claims one waiting dispatch, enqueues the same job and completes the outbox", async () => {
		const contract = buildAsyncImageDispatchContract(queueJob());
		await expect(dispatchAsyncImageTask(workerEnv(), contract)).resolves.toBe("dispatched");

		expect(taskStatusMocks.tryClaimTaskStatus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				taskId: "task-1",
				provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
			}),
		);
		expect(queueMocks.enqueueAsyncImageTask).toHaveBeenCalledWith(contract.job);
		expect(taskStatusMocks.upsertTaskStatus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: "completed", completedAt: expect.any(String) }),
		);
	});

	it("keeps a failed Redis handoff in the same durable outbox for bounded retry", async () => {
		queueMocks.enqueueAsyncImageTask.mockRejectedValueOnce(new Error("redis unavailable"));
		const contract = buildAsyncImageDispatchContract(queueJob());

		await expect(dispatchAsyncImageTask(workerEnv(), contract)).resolves.toBe("waiting");
		expect(taskStatusMocks.upsertTaskStatus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				status: "waiting",
				data: expect.objectContaining({ attempt: 1, lastError: "redis unavailable" }),
			}),
		);
	});

	it("reuses the worker sweep to recover a dispatch left before Redis enqueue", async () => {
		const contract = buildAsyncImageDispatchContract(queueJob());
		taskStatusMocks.requeueStaleClaimedTaskStatuses.mockResolvedValueOnce(1);
		taskStatusMocks.listTaskStatusesByProvider.mockResolvedValueOnce([{
			id: "dispatch-row-1",
			task_id: contract.job.taskId,
			provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
			user_id: contract.job.userId,
			status: "waiting",
			data: JSON.stringify(contract),
			created_at: contract.createdAt,
			updated_at: contract.createdAt,
			completed_at: null,
		}]);

		await expect(sweepAsyncImageDispatches({ env: workerEnv() })).resolves.toMatchObject({
			scanned: 1,
			dispatched: 1,
			recoveredClaims: 1,
		});
		expect(queueMocks.enqueueAsyncImageTask).toHaveBeenCalledTimes(1);
	});
});
