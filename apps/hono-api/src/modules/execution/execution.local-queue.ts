import {
	parseWorkflowNodeJob,
	type WorkflowNodeJob,
} from "./execution.node-attempt";

export type LocalWorkflowNodeDispatchFailure = Readonly<{
	job: WorkflowNodeJob;
	error: unknown;
}>;

type LocalWorkflowNodeQueueOptions = Readonly<{
	dispatch: (job: WorkflowNodeJob) => Promise<void>;
	schedule: (run: () => void, delayMs: number) => void;
	onFailure: (failure: LocalWorkflowNodeDispatchFailure) => void;
}>;

export type LocalWorkflowNodeQueue = Readonly<{
	send: (rawJob: unknown, delaySeconds?: number) => boolean;
	pendingCount: () => number;
}>;

export function workflowNodeDispatchIdentity(job: WorkflowNodeJob): string {
	return [
		job.executionId,
		job.nodeId,
		String(job.attempt),
		job.phase ?? "execute",
	].join("\u0000");
}

/**
 * The Node runtime emulates a durable queue with timers. Both a waiting job and
 * the periodic reconciler may schedule the same next check, so retain one local
 * timer per exact attempt/phase. The identity is released immediately before
 * dispatch, allowing the running handler to schedule its own next check while a
 * concurrent reconciler delivery collapses onto that same timer.
 */
export function createLocalWorkflowNodeQueue(
	options: LocalWorkflowNodeQueueOptions,
): LocalWorkflowNodeQueue {
	const pending = new Set<string>();
	return {
		send: (rawJob, delaySeconds = 0) => {
			const job = parseWorkflowNodeJob(rawJob);
			const identity = workflowNodeDispatchIdentity(job);
			if (pending.has(identity)) return false;
			pending.add(identity);
			const delayMs = Math.max(0, Number.isFinite(delaySeconds) ? delaySeconds : 0) * 1_000;
			options.schedule(() => {
				pending.delete(identity);
				void options.dispatch(job).catch((error: unknown) => {
					options.onFailure({ job, error });
				});
			}, delayMs);
			return true;
		},
		pendingCount: () => pending.size,
	};
}
