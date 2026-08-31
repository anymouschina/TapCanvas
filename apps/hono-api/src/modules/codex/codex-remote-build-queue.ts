import { Queue } from "bullmq";
import type {
	CodexRemoteBuildSpec,
} from "@tapcanvas/codex-task-protocol";
import type { WorkerEnv } from "../../types";
import {
	makeQueueConnection,
	QUEUE_NAMES,
} from "../task/queues";
import { sealCodexRemoteBuildSpec } from "./codex-remote-build-envelope";

export type CodexRemoteBuildJobData = {
	buildId: string;
	taskId: string;
	userId: string;
	bridgeId: string;
	workerInstanceId: string;
	leaseId: string;
	sourceSha256: string;
	archiveBytes: number;
	objectKey: string;
	sealedSpec: string;
};

let queue: Queue<CodexRemoteBuildJobData> | null = null;

function getQueue(): Queue<CodexRemoteBuildJobData> {
	if (queue) return queue;
	queue = new Queue<CodexRemoteBuildJobData>(
		QUEUE_NAMES.codexRemoteBuild,
		{ connection: makeQueueConnection() },
	);
	return queue;
}

export async function enqueueCodexRemoteBuild(input: {
	env: WorkerEnv;
	taskId: string;
	userId: string;
	bridgeId: string;
	workerInstanceId: string;
	leaseId: string;
	sourceSha256: string;
	archiveBytes: number;
	objectKey: string;
	spec: CodexRemoteBuildSpec;
}): Promise<{ buildId: string }> {
	const buildId = input.taskId;
	const data: CodexRemoteBuildJobData = {
		buildId,
		taskId: input.taskId,
		userId: input.userId,
		bridgeId: input.bridgeId,
		workerInstanceId: input.workerInstanceId,
		leaseId: input.leaseId,
		sourceSha256: input.sourceSha256,
		archiveBytes: input.archiveBytes,
		objectKey: input.objectKey,
		sealedSpec: sealCodexRemoteBuildSpec(input.env, input.spec),
	};
	await getQueue().add("build", data, {
		jobId: buildId,
		attempts: 1,
		removeOnComplete: { age: 86_400, count: 1_000 },
		removeOnFail: { age: 604_800, count: 1_000 },
	});
	return { buildId };
}
