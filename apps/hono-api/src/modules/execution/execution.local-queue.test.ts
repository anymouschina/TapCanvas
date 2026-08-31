import { describe, expect, it, vi } from "vitest";
import { createLocalWorkflowNodeQueue } from "./execution.local-queue";
import type { WorkflowNodeJob } from "./execution.node-attempt";

const job: WorkflowNodeJob = {
	executionId: "execution-1",
	nodeId: "agent-1",
	nodeRunId: "node-run-1",
	attempt: 2,
	phase: "await_external",
};

describe("local workflow node queue", () => {
	it("keeps one timer for an exact attempt and phase", () => {
		const scheduled: Array<() => void> = [];
		const queue = createLocalWorkflowNodeQueue({
			dispatch: vi.fn().mockResolvedValue(undefined),
			schedule: (run) => scheduled.push(run),
			onFailure: vi.fn(),
		});

		expect(queue.send(job, 5)).toBe(true);
		expect(queue.send({ ...job }, 5)).toBe(false);
		expect(scheduled).toHaveLength(1);
		expect(queue.pendingCount()).toBe(1);
	});

	it("allows the active handler to schedule exactly one successor", async () => {
		const scheduled: Array<() => void> = [];
		let queue: ReturnType<typeof createLocalWorkflowNodeQueue>;
		const dispatch = vi.fn(async () => {
			expect(queue.send(job, 5)).toBe(true);
			expect(queue.send(job, 5)).toBe(false);
		});
		queue = createLocalWorkflowNodeQueue({
			dispatch,
			schedule: (run) => scheduled.push(run),
			onFailure: vi.fn(),
		});

		queue.send(job, 5);
		scheduled.shift()?.();
		await Promise.resolve();
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(scheduled).toHaveLength(1);
		expect(queue.pendingCount()).toBe(1);
	});

	it("does not collapse a new attempt or execution phase", () => {
		const scheduled: Array<() => void> = [];
		const queue = createLocalWorkflowNodeQueue({
			dispatch: vi.fn().mockResolvedValue(undefined),
			schedule: (run) => scheduled.push(run),
			onFailure: vi.fn(),
		});

		expect(queue.send(job, 5)).toBe(true);
		expect(queue.send({ ...job, attempt: 3, nodeRunId: "node-run-2" }, 5)).toBe(true);
		expect(queue.send({ ...job, phase: "recover" }, 5)).toBe(true);
		expect(scheduled).toHaveLength(3);
	});
});
