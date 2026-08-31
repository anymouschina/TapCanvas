import { createHash } from "node:crypto";
import { Queue } from "bullmq";

import type { AsyncAgentContinuation } from "./async-agent-continuation";
import type { ContinuationSettlementRecordV1 } from "./agents-continuation-settlement";
import { makeQueueConnection, QUEUE_NAMES } from "./queues";

export type AsyncAgentContinuationQueueJob = Readonly<{
		kind: "continuation";
		continuation: AsyncAgentContinuation;
		enqueuedAt: string;
}>;

export type ContinuationSettlementQueueJob = Readonly<{
		kind: "settlement_recovery";
		record: ContinuationSettlementRecordV1;
		enqueuedAt: string;
}>;

let queue: Queue<AsyncAgentContinuationQueueJob> | null = null;
let settlementQueue: Queue<ContinuationSettlementQueueJob> | null = null;

function getQueue(): Queue<AsyncAgentContinuationQueueJob> {
	if (queue) return queue;
	queue = new Queue<AsyncAgentContinuationQueueJob>(
		QUEUE_NAMES.asyncAgentContinuation,
		{ connection: makeQueueConnection() },
	);
	return queue;
}

function getSettlementQueue(): Queue<ContinuationSettlementQueueJob> {
	if (settlementQueue) return settlementQueue;
	settlementQueue = new Queue<ContinuationSettlementQueueJob>(
		QUEUE_NAMES.continuationSettlement,
		{ connection: makeQueueConnection() },
	);
	return settlementQueue;
}

export function buildAsyncAgentContinuationQueueJobId(
	continuation: Pick<AsyncAgentContinuation, "id" | "attempt" | "claimToken" | "progressFingerprint">,
): string {
	const continuationId = continuation.id.trim();
	const executionIdentity = continuation.claimToken?.trim() || continuation.progressFingerprint.trim();
	if (!continuationId || !executionIdentity) {
		throw new Error("async continuation queue requires a durable contract identity");
	}
	const identity = [continuationId, continuation.attempt, executionIdentity].join("\u001f");
	return `continuation-${createHash("sha256").update(identity).digest("hex")}`;
}

/**
 * Queue only claimed contracts. BullMQ retries are intentionally disabled:
 * business retry/backoff and claim recovery are owned by the persisted
 * continuation state machine, so transport retries cannot duplicate an agent run.
 */
export async function enqueueAsyncAgentContinuations(
	continuations: readonly AsyncAgentContinuation[],
): Promise<number> {
	if (continuations.length === 0) return 0;
	const enqueuedAt = new Date().toISOString();
	await getQueue().addBulk(continuations.map((continuation) => ({
		name: "resume",
		data: { kind: "continuation" as const, continuation, enqueuedAt },
		opts: {
			jobId: buildAsyncAgentContinuationQueueJobId(continuation),
			attempts: 1,
			removeOnComplete: true,
			removeOnFail: true,
		},
	})));
	return continuations.length;
}

export async function enqueueContinuationSettlementRecoveries(
	records: readonly ContinuationSettlementRecordV1[],
): Promise<number> {
	if (records.length === 0) return 0;
	const enqueuedAt = new Date().toISOString();
	await getSettlementQueue().addBulk(records.map((record) => ({
		name: "recover-settlement",
		data: {
			kind: "settlement_recovery" as const,
			record,
			enqueuedAt,
		},
		opts: {
			jobId: `settlement-${createHash("sha256")
				.update([record.effectId, record.attempt].join("\u001f"))
				.digest("hex")}`,
			attempts: 1,
			removeOnComplete: true,
			removeOnFail: true,
		},
	})));
	return records.length;
}
