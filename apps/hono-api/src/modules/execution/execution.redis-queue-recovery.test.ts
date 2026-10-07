import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowNodeJob } from "./execution.node-attempt";

type Receipt = { token: string; dueAt: number; publishLeaseUntil?: number };
type QueuedJob = { name: string; data: WorkflowNodeJob; id: string };
const fake = vi.hoisted(() => ({
	receipts: new Map<string, Receipt>(),
	expiresAt: new Map<string, number>(),
	jobs: new Map<string, QueuedJob>(),
	finishedJobs: new Set<string>(),
	eval: vi.fn(), add: vi.fn(),
	processor: undefined as undefined | ((job: QueuedJob) => Promise<void>),
}));
const queuePrefix = "custom-prefix:tapcanvas-workflow-node-dispatch:";
vi.mock("ioredis", () => ({ default: class { eval = fake.eval; quit = vi.fn(); } }));
vi.mock("bullmq", () => ({
	Queue: class {
		add = fake.add;
		close = vi.fn();
		toKey = (suffix: string) => `${queuePrefix}${suffix}`;
	},
	Worker: class {
		constructor(_name: string, processor: NonNullable<typeof fake.processor>) { fake.processor = processor; }
		on = vi.fn(); close = vi.fn();
	},
}));
import { createRedisWorkflowNodeQueueConsumer, createRedisWorkflowNodeQueueProducer } from "./execution.redis-queue";
import { CLAIM_DISPATCH_SCRIPT, DISPATCH_PUBLICATION_LEASE_MS, RELEASE_UNPUBLISHED_DISPATCH_SCRIPT, RESERVE_DISPATCH_SCRIPT } from "./execution.redis-queue-reservation";

const job: WorkflowNodeJob = { executionId: "exec", nodeId: "node", nodeRunId: "run", attempt: 1, phase: "await_external" };

// In-memory Redis/BullMQ boundary: execute the three atomic receipt operations,
// keeping job existence independent of publication responses and fake wall time.
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_000);
	fake.receipts.clear(); fake.expiresAt.clear(); fake.jobs.clear(); fake.finishedJobs.clear(); fake.eval.mockReset(); fake.add.mockReset();
	fake.eval.mockImplementation(async (script: string, keyCount: number, ...args: (string | number)[]) => {
		const key = String(args[0]);
		const expiresAt = fake.expiresAt.get(key);
		if (expiresAt !== undefined && expiresAt <= Date.now()) {
			fake.receipts.delete(key); fake.expiresAt.delete(key);
		}
		const current = fake.receipts.get(key);
		if (script === RESERVE_DISPATCH_SCRIPT) {
			expect(keyCount).toBe(1);
			const [token, dueAt, now, publishLeaseUntil, prefix] = args.slice(1);
			const jobKey = `${prefix}${current?.token}`;
			const jobExists = current && fake.jobs.has(jobKey);
			const published = jobExists && !fake.finishedJobs.has(jobKey);
			if (published) fake.expiresAt.delete(key);
			const publishing = !jobExists && current?.publishLeaseUntil !== undefined && current.publishLeaseUntil > Number(now);
			if (current && (published || publishing) && current.dueAt <= Number(dueAt)) return 0;
			fake.receipts.set(key, { token: String(token), dueAt: Number(dueAt), publishLeaseUntil: Number(publishLeaseUntil) });
			return 1;
		}
		if (script === CLAIM_DISPATCH_SCRIPT) {
			if (current?.token !== args[1]) return 0;
			fake.receipts.delete(key); return 1;
		}
		if (script === RELEASE_UNPUBLISHED_DISPATCH_SCRIPT) {
			expect(keyCount).toBe(2);
			if (current?.token !== args[2] || fake.jobs.has(String(args[1]))) return 0;
			fake.receipts.delete(key); return 1;
		}
		throw new Error("Unexpected reservation script");
	});

	fake.add.mockImplementation(async (name: string, data: WorkflowNodeJob, options: { jobId: string }) => {
		const queued = { name, data, id: options.jobId };
		fake.jobs.set(`${queuePrefix}${queued.id}`, queued);
		return queued;
	});
	vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function pendingJob(): QueuedJob {
	const receipt = [...fake.receipts.values()][0]!;
	return fake.jobs.get(`${queuePrefix}${receipt.token}`)!;
}

describe("job-backed dispatch recovery with an isolated clock", () => {
	it("removes a pending receipt TTL when the actual job proves publication", async () => {
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await producer.send(job);
		const original = pendingJob();
		const key = [...fake.receipts.keys()][0]!;
		fake.expiresAt.set(key, Date.now() + 120_000);
		await producer.send(job);
		expect(fake.expiresAt.has(key)).toBe(false);
		vi.advanceTimersByTime(15 * 60_000);
		await producer.send(job);
		expect(fake.add).toHaveBeenCalledTimes(1);
		expect(pendingJob().id).toBe(original.id);
		expect(RESERVE_DISPATCH_SCRIPT).toContain("redis.call('PERSIST', KEYS[1])");
	});
	it("demonstrates that the former TTL loses a queued job and admits its replacement", () => {
		const oldReceipt = { token: "original", expiresAt: Date.now() + 120_000 };
		const queuedIds = [oldReceipt.token];
		vi.advanceTimersByTime(15 * 60_000);
		const currentReceipt = Date.now() < oldReceipt.expiresAt ? oldReceipt : undefined;
		expect(currentReceipt?.token === queuedIds[0]).toBe(false);
		if (!currentReceipt) queuedIds.push("replacement");
		expect(queuedIds).toEqual(["original", "replacement"]);
	});

	it("keeps the original queue position and claim after fifteen minutes of backlog", async () => {
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await producer.send(job);
		const original = pendingJob();
		vi.advanceTimersByTime(15 * 60_000);
		await producer.send(job);
		expect(fake.add).toHaveBeenCalledTimes(1);
		expect(pendingJob().id).toBe(original.id);
		const dispatch = vi.fn().mockResolvedValue(undefined);
		createRedisWorkflowNodeQueueConsumer({ redisUrl: "redis://isolated-test", concurrency: 1, dispatch });
		await fake.processor!(original);
		expect(dispatch).toHaveBeenCalledWith(job);
		expect(fake.receipts.size).toBe(0);
		expect(RESERVE_DISPATCH_SCRIPT).not.toContain("'PX'");
	});

	it("recovers a publisher crash after the bounded unpublished lease", async () => {
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await producer.send(job);
		const receipt = [...fake.receipts.values()][0]!;
		// The same receipt state as a process crash between reserve and queue.add.
		fake.jobs.clear(); fake.add.mockClear();
		await producer.send(job);
		expect(fake.add).not.toHaveBeenCalled();
		vi.advanceTimersByTime(DISPATCH_PUBLICATION_LEASE_MS);
		await producer.send(job);
		expect(fake.add).toHaveBeenCalledTimes(1);
		expect(pendingJob().id).not.toBe(receipt.token);
	});

	it("allows an earlier due delivery to supersede the old token without stale execution", async () => {
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await producer.send(job, { delaySeconds: 600 });
		const delayed = pendingJob();
		await producer.send(job);
		const earlier = pendingJob();
		expect(earlier.id).not.toBe(delayed.id);
		const dispatch = vi.fn().mockResolvedValue(undefined);
		createRedisWorkflowNodeQueueConsumer({ redisUrl: "redis://isolated-test", concurrency: 1, dispatch });
		await fake.processor!(delayed);
		expect(fake.receipts.size).toBe(1);
		expect(dispatch).not.toHaveBeenCalled();
		await fake.processor!(earlier);
		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	it("releases pending identity before an active external check schedules its next check", async () => {
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await producer.send(job);
		const active = pendingJob();
		const dispatch = vi.fn(async () => { await producer.send(job, { delaySeconds: 30 }); });
		createRedisWorkflowNodeQueueConsumer({ redisUrl: "redis://isolated-test", concurrency: 1, dispatch });
		await fake.processor!(active);
		expect(fake.add).toHaveBeenCalledTimes(2);
		expect(pendingJob().id).not.toBe(active.id);
		await producer.send(job, { delaySeconds: 30 });
		expect(fake.add).toHaveBeenCalledTimes(2);
	});

	it("preserves an accepted job when its publication response is lost", async () => {
		const add = fake.add.getMockImplementation()!;
		const publicationError = new Error("add response lost");
		fake.add.mockImplementationOnce(async (...args: [string, WorkflowNodeJob, { jobId: string }]) => {
			await add(...args); throw publicationError;
		});
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await expect(producer.send(job)).rejects.toBe(publicationError);
		const accepted = pendingJob();
		vi.advanceTimersByTime(15 * 60_000);
		await producer.send(job);
		expect(fake.add).toHaveBeenCalledTimes(1);
		expect(pendingJob().id).toBe(accepted.id);
	});

	it("preserves the reservation and both errors when publication status cannot be queried", async () => {
		const publicationError = new Error("add unavailable");
		const statusError = new Error("Redis status unavailable");
		fake.add.mockRejectedValueOnce(publicationError);
		const evalScript = fake.eval.getMockImplementation()!;
		fake.eval.mockImplementation(async (script: string, ...args: [number, ...(string | number)[]]) => {
			if (script === RELEASE_UNPUBLISHED_DISPATCH_SCRIPT) throw statusError;
			return evalScript(script, ...args);
		});
		await expect(createRedisWorkflowNodeQueueProducer("redis://isolated-test").send(job))
			.rejects.toMatchObject({ errors: [publicationError, statusError] });
		expect(fake.receipts.size).toBe(1);
	});

	it("releases a confirmed unpublished failure so the durable intent can retry immediately", async () => {
		fake.add.mockRejectedValueOnce(new Error("not accepted"));
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await expect(producer.send(job)).rejects.toThrow("not accepted");
		expect(fake.receipts.size).toBe(0);
		await producer.send(job);
		expect(pendingJob()).toBeDefined();
	});

	it("requeues a retained failed job after consumer claim fails before dispatch", async () => {
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await producer.send(job);
		const original = pendingJob();
		const dispatch = vi.fn().mockResolvedValue(undefined);
		createRedisWorkflowNodeQueueConsumer({ redisUrl: "redis://isolated-test", concurrency: 1, dispatch });
		fake.eval.mockRejectedValueOnce(new Error("claim connection lost"));
		await expect(fake.processor!(original)).rejects.toThrow("claim connection lost");
		expect(dispatch).not.toHaveBeenCalled();
		// BullMQ retains failed job hashes and atomically records finishedOn.
		fake.finishedJobs.add(`${queuePrefix}${original.id}`);
		await producer.send(job);
		const recovered = pendingJob();
		expect(recovered.id).not.toBe(original.id);
		expect(fake.add).toHaveBeenCalledTimes(2);
		await fake.processor!(recovered);
		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	it("keeps distinct attempts and durable node runs independently pending", async () => {
		const producer = createRedisWorkflowNodeQueueProducer("redis://isolated-test");
		await producer.send(job);
		await producer.send({ ...job, attempt: 2 });
		await producer.send({ ...job, nodeRunId: "another-run" });
		expect(fake.receipts.size).toBe(3);
		expect(fake.add).toHaveBeenCalledTimes(3);
	});
});
