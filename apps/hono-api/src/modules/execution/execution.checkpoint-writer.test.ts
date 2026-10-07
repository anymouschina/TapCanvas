import { expect, it, vi } from "vitest";
import { createCheckpointWriter } from "./execution.checkpoint-writer";

it("coalesces concurrent cumulative snapshots and acknowledges only the committed frontier", async () => {
	let release: () => void = () => { throw new Error("write not started"); };
	const write = vi.fn(async (_value: number) => new Promise<void>((resolve) => { release = resolve; }));
	const checkpoint = createCheckpointWriter(write);
	const first = checkpoint(() => 1);
	await Promise.resolve();
	let acknowledged = false;
	const second = checkpoint(() => 2);
	const third = checkpoint(() => 3).then(() => { acknowledged = true; });
	expect(write).toHaveBeenCalledTimes(1);
	release();
	await first;
	expect(acknowledged).toBe(false);
	expect(write.mock.calls.map(([value]) => value)).toEqual([1, 3]);
	release();
	await Promise.all([second, third]);
	expect(acknowledged).toBe(true);
});

it("rejects all uncommitted receipts on failure without acknowledging or silently dropping them", async () => {
	let rejectWrite: (error: unknown) => void = () => { throw new Error("write not started"); };
	const write = vi.fn(async (_value: number) => new Promise<void>((_resolve, reject) => { rejectWrite = reject; }));
	const checkpoint = createCheckpointWriter(write);
	const first = checkpoint(() => 1);
	await Promise.resolve();
	const second = checkpoint(() => 2);
	const settled = Promise.allSettled([first, second]);
	const error = new Error("database unavailable");
	rejectWrite(error);
	expect(await settled).toEqual([{ status: "rejected", reason: error }, { status: "rejected", reason: error }]);
	await expect(checkpoint(() => 3)).rejects.toBe(error);
	expect(write).toHaveBeenCalledTimes(1);
});
