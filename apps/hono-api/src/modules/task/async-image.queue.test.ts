import { describe, expect, it } from "vitest";

import {
	AsyncImageQueueReadinessError,
	assertAsyncImageQueueReady,
	buildAsyncImageQueueJobId,
	type AsyncImageQueueJob,
	type AsyncImageQueueReadinessProbe,
} from "./async-image.queue";

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

function readinessProbe(input: {
	workerCount?: number;
	waitUntilReady?: () => Promise<unknown>;
} = {}): AsyncImageQueueReadinessProbe {
	return {
		waitUntilReady: input.waitUntilReady ?? (async () => undefined),
		getWorkersCount: async () => input.workerCount ?? 1,
	};
}

describe("async image BullMQ identity", () => {
	it("is stable for one owner/task and changes across owners", () => {
		const first = buildAsyncImageQueueJobId(queueJob());
		const repeated = buildAsyncImageQueueJobId(queueJob());
		const otherOwner = buildAsyncImageQueueJobId(queueJob({ userId: "user-2" }));

		expect(first).toBe(repeated);
		expect(first).not.toBe(otherOwner);
		expect(first).not.toContain(":");
	});
});

describe("async image queue readiness", () => {
	it("requires a registered worker", async () => {
		await expect(assertAsyncImageQueueReady(readinessProbe({ workerCount: 1 }))).resolves.toBeUndefined();
		await expect(assertAsyncImageQueueReady(readinessProbe({ workerCount: 0 }))).rejects.toMatchObject({
			code: "async_image_worker_unavailable",
		});
	});

	it("bounds Redis and worker-count readiness", async () => {
		const neverReady = new Promise<never>(() => undefined);
		await expect(assertAsyncImageQueueReady(readinessProbe({
			waitUntilReady: () => neverReady,
		}), 5)).rejects.toEqual(expect.objectContaining<Partial<AsyncImageQueueReadinessError>>({
			code: "async_image_queue_unavailable",
		}));

		await expect(assertAsyncImageQueueReady({
			waitUntilReady: async () => undefined,
			getWorkersCount: () => neverReady,
		}, 5)).rejects.toMatchObject({
			code: "async_image_queue_unavailable",
		});
	});
});
