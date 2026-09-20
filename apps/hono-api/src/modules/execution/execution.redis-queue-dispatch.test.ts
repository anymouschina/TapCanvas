import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowNodeJob } from "./execution.node-attempt";

const fake = vi.hoisted(() => ({
	reserve: vi.fn(), add: vi.fn(), close: vi.fn(), quit: vi.fn(),
	processor: undefined as undefined | ((job: { name: string; data: WorkflowNodeJob; id: string }) => Promise<void>),
}));
vi.mock("ioredis", () => ({ default: class {
	eval = fake.reserve;
	quit = fake.quit;
} }));
vi.mock("bullmq", () => ({
	Queue: class { add = fake.add; close = fake.close; },
	Worker: class {
		constructor(_name: string, processor: NonNullable<typeof fake.processor>) { fake.processor = processor; }
		on = vi.fn(); close = fake.close;
	},
}));
import { CLAIM_DISPATCH_SCRIPT, createRedisWorkflowNodeQueueConsumer, createRedisWorkflowNodeQueueProducer, RESERVE_DISPATCH_SCRIPT } from "./execution.redis-queue";

const job: WorkflowNodeJob = { executionId: "exec", nodeId: "node", nodeRunId: "run", attempt: 1, phase: "await_external" };
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("Redis dispatch reservation integration", () => {
	it("uses the atomically admitted reservation token as the BullMQ claim identity", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1_000);
		fake.reserve.mockResolvedValue(1);
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await producer.send(job, { delaySeconds: 600 });
		const reserveCall = fake.reserve.mock.calls[0]!;
		expect(reserveCall[0]).toBe(RESERVE_DISPATCH_SCRIPT);
		expect(reserveCall[4]).toBe(601_000);
		expect(fake.add).toHaveBeenCalledWith("dispatch", job, expect.objectContaining({ jobId: reserveCall[3], delay: 600_000 }));
		await producer.close();
	});

	it("does not enqueue a rejected later duplicate", async () => {
		fake.reserve.mockResolvedValue(0);
		await createRedisWorkflowNodeQueueProducer("redis://isolated-test").send(job);
		expect(fake.add).not.toHaveBeenCalled();
	});

	it("a stale queued delivery cannot execute or release the current reservation", async () => {
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		const dispatch = vi.fn().mockResolvedValue(undefined);
		const onActive = vi.fn();
		createRedisWorkflowNodeQueueConsumer({ redisUrl: "redis://isolated-test", concurrency: 1, dispatch, onActive });
		fake.reserve.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
		await fake.processor!({ name: "dispatch", id: "obsolete", data: job });
		expect(dispatch).not.toHaveBeenCalled();
		expect(onActive).not.toHaveBeenCalled();
		await fake.processor!({ name: "dispatch", id: "current", data: job });
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch).toHaveBeenCalledWith(job);
		expect(fake.reserve.mock.calls[0]![0]).toBe(CLAIM_DISPATCH_SCRIPT);
		expect(fake.reserve.mock.calls[0]![3]).toBe("obsolete");
		expect(fake.reserve.mock.calls[1]![3]).toBe("current");
	});
});
