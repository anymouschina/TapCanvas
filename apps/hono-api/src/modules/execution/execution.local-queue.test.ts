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

it("an earlier wakeup replaces a delayed poll and its stale timer cannot consume the successor", async () => {
	const scheduled: Array<{ run: () => void; delay: number }> = [];
	const dispatch = vi.fn().mockResolvedValue(undefined);
	const queue = createLocalWorkflowNodeQueue({
		dispatch,
		now: () => 1_000,
		schedule: (run, delay) => scheduled.push({ run, delay }),
		onFailure: vi.fn(),
	});
	expect(queue.send(job, 600)).toBe(true);
	expect(queue.send(job, 0)).toBe(true);
	expect(scheduled.map(({ delay }) => delay)).toEqual([600_000, 0]);
	scheduled[1]!.run();
	await Promise.resolve();
	expect(dispatch).toHaveBeenCalledTimes(1);
	expect(queue.send(job, 900)).toBe(true);
	scheduled[0]!.run();
	expect(dispatch).toHaveBeenCalledTimes(1);
	expect(queue.pendingCount()).toBe(1);
	scheduled[2]!.run();
	await Promise.resolve();
	expect(dispatch).toHaveBeenCalledTimes(2);
});

it("does not deduplicate a distinct durable node run with the same attempt", () => {
	const queue = createLocalWorkflowNodeQueue({
		dispatch: vi.fn().mockResolvedValue(undefined),
		schedule: vi.fn(),
		onFailure: vi.fn(),
	});
	expect(queue.send(job, 5)).toBe(true);
	expect(queue.send({ ...job, nodeRunId: "distinct-node-run" }, 5)).toBe(true);
	expect(queue.pendingCount()).toBe(2);
});
