import { createHash, randomUUID } from "node:crypto";

import * as bullmq from "bullmq";
import IORedis from "ioredis";

import {
	parseWorkflowNodeJob,
	type WorkflowNodeJob,
} from "./execution.node-attempt";

const { Queue, Worker } = bullmq;

export const WORKFLOW_NODE_QUEUE_NAME = "tapcanvas-workflow-node-dispatch";
const WORKFLOW_NODE_QUEUE_DEDUPE_PREFIX = "tapcanvas:workflow-node-dispatch:pending";
const MINIMUM_DEDUPE_TTL_MS = 120_000;
const DEDUPE_DELAY_PADDING_MS = 60_000;

type WorkflowNodeQueueSendOptions = Readonly<{
	delaySeconds?: number;
}>;

export type RedisWorkflowNodeQueueProducer = Readonly<{
	send: (rawJob: unknown, options?: WorkflowNodeQueueSendOptions) => Promise<void>;
	close: () => Promise<void>;
}>;

export type RedisWorkflowNodeQueueConsumer = Readonly<{
	close: () => Promise<void>;
}>;

function workflowNodeDispatchIdentity(job: WorkflowNodeJob): string {
	return [
		job.executionId,
		job.nodeId,
		job.nodeRunId,
		String(job.attempt),
		job.phase ?? "execute",
	].join("\u0000");
}

export function workflowNodeDispatchDigest(job: WorkflowNodeJob): string {
	return createHash("sha256").update(workflowNodeDispatchIdentity(job)).digest("hex");
}

function workflowNodeDedupeKey(job: WorkflowNodeJob): string {
	return `${WORKFLOW_NODE_QUEUE_DEDUPE_PREFIX}:${workflowNodeDispatchDigest(job)}`;
}

function normalizeDelayMs(delaySeconds: unknown): number {
	const seconds = Number(delaySeconds ?? 0);
	if (!Number.isFinite(seconds)) return 0;
	return Math.max(0, Math.floor(seconds * 1_000));
}

function createBullMqConnection(redisUrl: string): IORedis {
	if (!redisUrl.trim()) throw new Error("Workflow node queue requires REDIS_URL");
	return new IORedis(redisUrl, {
		maxRetriesPerRequest: null,
	});
}

const RELEASE_DEDUPE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Cross-process workflow dispatch producer.
 *
 * The short-lived Redis key represents only a pending delivery, not node
 * ownership. The worker deletes it before executing the job. That preserves
 * the local runtime's important re-entrant property: an active external-wait
 * check can schedule its next exact check while duplicate pending deliveries
 * from reconcilers still collapse to one queue item.
 */
export function createRedisWorkflowNodeQueueProducer(
	redisUrl: string,
): RedisWorkflowNodeQueueProducer {
	const connection = createBullMqConnection(redisUrl);
	const queue = new Queue<WorkflowNodeJob>(WORKFLOW_NODE_QUEUE_NAME, { connection });
	return {
		send: async (rawJob, options = {}) => {
			const job = parseWorkflowNodeJob(rawJob);
			const delayMs = normalizeDelayMs(options.delaySeconds);
			const dedupeKey = workflowNodeDedupeKey(job);
			const dedupeToken = randomUUID();
			const dedupeTtlMs = Math.max(
				MINIMUM_DEDUPE_TTL_MS,
				delayMs + DEDUPE_DELAY_PADDING_MS,
			);
			const accepted = await connection.set(
				dedupeKey,
				dedupeToken,
				"PX",
				dedupeTtlMs,
				"NX",
			);
			if (accepted !== "OK") return;
			try {
				await queue.add("dispatch", job, {
					jobId: `workflow-node-${randomUUID()}`,
					...(delayMs > 0 ? { delay: delayMs } : {}),
					attempts: 1,
					removeOnComplete: true,
					removeOnFail: { age: 86_400 },
				});
			} catch (error) {
				await connection.eval(RELEASE_DEDUPE_SCRIPT, 1, dedupeKey, dedupeToken)
					.catch(() => undefined);
				throw error;
			}
		},
		close: async () => {
			await queue.close();
			await connection.quit();
		},
	};
}

export function createRedisWorkflowNodeQueueConsumer(input: Readonly<{
	redisUrl: string;
	concurrency: number;
	dispatch: (job: WorkflowNodeJob) => Promise<void>;
	onActive?: (job: WorkflowNodeJob) => void;
	onFailure?: (input: Readonly<{ job: WorkflowNodeJob; error: unknown }>) => void;
}>): RedisWorkflowNodeQueueConsumer {
	const connection = createBullMqConnection(input.redisUrl);
	const concurrency = Math.max(1, Math.min(32, Math.floor(input.concurrency)));
	const worker = new Worker<WorkflowNodeJob>(
		WORKFLOW_NODE_QUEUE_NAME,
		async (queueJob) => {
			if (queueJob.name !== "dispatch") {
				throw new Error(`Unknown workflow node queue job: ${queueJob.name}`);
			}
			const job = parseWorkflowNodeJob(queueJob.data);
			// Pending-delivery dedupe ends at claim time. Durable node-run ownership
			// remains authoritative and rejects stale or duplicate active work.
			await connection.del(workflowNodeDedupeKey(job));
			input.onActive?.(job);
			try {
				await input.dispatch(job);
			} catch (error) {
				input.onFailure?.({ job, error });
				throw error;
			}
		},
		{
			connection,
			concurrency,
		},
	);
	worker.on("error", (error) => {
		console.error("[workflow-node-worker] queue error", error);
	});
	return {
		close: async () => {
			await worker.close();
			await connection.quit();
		},
	};
}
