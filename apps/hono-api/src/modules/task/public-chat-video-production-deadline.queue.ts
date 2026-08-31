import { createHash } from "node:crypto";
import { Queue } from "bullmq";

import type { DurableTaskReferenceV1 } from "./task.agents-bridge";
import { makeQueueConnection, QUEUE_NAMES } from "./queues";

export type PublicChatVideoProductionDeadlineJob = Readonly<{
	version: 2;
	userId: string;
	sessionKey: string;
	publicTurnId: string;
	rootTraceId: string;
	deadlineAt: string;
	userIntentContract?: Record<string, unknown>;
	durableTaskReferences?: readonly DurableTaskReferenceV1[];
}>;

let queue: Queue<PublicChatVideoProductionDeadlineJob> | null = null;

function getQueue(): Queue<PublicChatVideoProductionDeadlineJob> {
	if (queue) return queue;
	queue = new Queue<PublicChatVideoProductionDeadlineJob>(
		QUEUE_NAMES.publicChatVideoProductionDeadline,
		{ connection: makeQueueConnection() },
	);
	return queue;
}

export function buildPublicChatVideoProductionDeadlineJobId(
	job: PublicChatVideoProductionDeadlineJob,
): string {
	const contractHash = typeof job.userIntentContract?.contractHash === "string"
		? job.userIntentContract.contractHash.trim()
		: "initial-probe";
	const identity = [job.publicTurnId, job.deadlineAt, contractHash].join("\u001f");
	return `video-start-deadline-${createHash("sha256").update(identity).digest("hex")}`;
}

export async function enqueuePublicChatVideoProductionDeadline(
	job: PublicChatVideoProductionDeadlineJob,
	nowMs = Date.now(),
): Promise<void> {
	if (job.version !== 2) throw new Error("public_chat_video_production_deadline_job_version_invalid");
	const deadlineMs = Date.parse(job.deadlineAt);
	if (!Number.isFinite(deadlineMs)) throw new Error("public_chat_video_production_deadline_invalid_time");
	await getQueue().add("enforce", job, {
		jobId: buildPublicChatVideoProductionDeadlineJobId(job),
		delay: Math.max(0, deadlineMs - nowMs),
		// The delayed probe can race the root model turn that freezes the
		// UserIntentContract. Keep probing the same immutable deadline while the
		// trace is active; as soon as the contract appears, an already-expired
		// video task is failed immediately instead of silently losing its SLA.
		attempts: 120,
		backoff: { type: "fixed", delay: 5_000 },
		removeOnComplete: true,
		removeOnFail: 100,
	});
}
