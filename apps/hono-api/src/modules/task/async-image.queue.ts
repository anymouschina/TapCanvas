import { createHash } from "node:crypto";
import { Queue } from "bullmq";

import type { TaskRequestDto } from "./task.schemas";
import { makeQueueConnection, QUEUE_NAMES } from "./queues";

export type AsyncImageQueueJob = Readonly<{
	taskId: string;
	userId: string;
	request: TaskRequestDto;
	activeTeamId: string | null;
	apiKeyBillingTeamId: string | null;
	apiKeyId: string | null;
	enqueuedAt: string;
}>;

export type AsyncImageQueueReadinessProbe = Readonly<{
	waitUntilReady: () => Promise<unknown>;
	getWorkersCount: () => Promise<number>;
}>;

export class AsyncImageQueueReadinessError extends Error {
	readonly code: "async_image_queue_unavailable" | "async_image_worker_unavailable";

	constructor(
		code: "async_image_queue_unavailable" | "async_image_worker_unavailable",
		message: string,
	) {
		super(message);
		this.name = "AsyncImageQueueReadinessError";
		this.code = code;
	}
}

let queue: Queue<AsyncImageQueueJob> | null = null;
const QUEUE_READY_TIMEOUT_MS = 5_000;

function getQueue(): Queue<AsyncImageQueueJob> {
	if (queue) return queue;
	queue = new Queue<AsyncImageQueueJob>(QUEUE_NAMES.asyncImage, {
		connection: makeQueueConnection(),
	});
	return queue;
}

export function buildAsyncImageQueueJobId(job: AsyncImageQueueJob): string {
	const identity = `${job.userId}\u001f${job.taskId}`;
	return `async-image-${createHash("sha256").update(identity).digest("hex")}`;
}

export async function assertAsyncImageQueueReady(
	probe: AsyncImageQueueReadinessProbe,
	timeoutMs = QUEUE_READY_TIMEOUT_MS,
): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	try {
		await Promise.race([
			(async () => {
				await probe.waitUntilReady();
				const workerCount = await probe.getWorkersCount();
				if (!Number.isInteger(workerCount) || workerCount < 1) {
					throw new AsyncImageQueueReadinessError(
						"async_image_worker_unavailable",
						"Async image queue has no active workers",
					);
				}
			})(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new AsyncImageQueueReadinessError(
						"async_image_queue_unavailable",
						"Async image queue readiness timed out",
					)),
					timeoutMs,
				);
			}),
		]);
	} catch (error) {
		if (error instanceof AsyncImageQueueReadinessError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new AsyncImageQueueReadinessError(
			"async_image_queue_unavailable",
			`Async image queue readiness failed: ${message}`,
		);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

export async function ensureAsyncImageQueueReady(): Promise<void> {
	const activeQueue = getQueue();
	try {
		await assertAsyncImageQueueReady(activeQueue);
	} catch (error) {
		if (queue === activeQueue) queue = null;
		await activeQueue.disconnect();
		throw error;
	}
}

export async function enqueueAsyncImageTask(
	job: AsyncImageQueueJob,
): Promise<{ queueName: string; queueJobId: string }> {
	const queueJobId = buildAsyncImageQueueJobId(job);
	await getQueue().add("async-image", job, {
		jobId: queueJobId,
		attempts: 1,
		removeOnComplete: true,
		removeOnFail: 200,
	});
	return { queueName: QUEUE_NAMES.asyncImage, queueJobId };
}
