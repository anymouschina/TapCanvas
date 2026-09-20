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
	now?: () => number;
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
		job.nodeRunId,
		String(job.attempt),
		job.phase ?? "execute",
	].join("\u0000");
}

/**
 * The Node runtime emulates a durable queue with timers. Both a waiting job and
 * the periodic reconciler may schedule the same next check, so retain one local
 * earliest timer per exact durable node run/attempt/phase. Earlier signals
 * supersede later timers, whose callbacks become inert. The identity is released immediately before
 * dispatch, allowing the running handler to schedule its own next check while a
 * concurrent reconciler delivery collapses onto that same timer.
 */
export function createLocalWorkflowNodeQueue(
	options: LocalWorkflowNodeQueueOptions,
): LocalWorkflowNodeQueue {
	const pending = new Map<string, { dueAt: number }>();
	return {
		send: (rawJob, delaySeconds = 0) => {
			const job = parseWorkflowNodeJob(rawJob);
			const identity = workflowNodeDispatchIdentity(job);
			const delayMs = Math.max(0, Number.isFinite(delaySeconds) ? delaySeconds : 0) * 1_000;
			const entry = { dueAt: (options.now ?? Date.now)() + delayMs };
			const previous = pending.get(identity);
			if (previous && previous.dueAt <= entry.dueAt) return false;
			pending.set(identity, entry);
			options.schedule(() => {
				// An earlier signal supersedes this timer without letting its stale callback
				// release a successor scheduled by the current handler.
				if (pending.get(identity) !== entry) return;
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
