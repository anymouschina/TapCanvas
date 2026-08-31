import { describe, expect, it } from "vitest";

import {
	waitForCanvasRevisionRetry,
	withChapterCanvasWriteQueue,
} from "./chapter-canvas-write-queue";

describe("withChapterCanvasWriteQueue", () => {
	it("serializes concurrent mutations of the same chapter in arrival order", async () => {
		const events: string[] = [];
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = withChapterCanvasWriteQueue("chapter-1", async () => {
			events.push("first:start");
			await firstGate;
			events.push("first:end");
			return "first";
		});
		const second = withChapterCanvasWriteQueue("chapter-1", async () => {
			events.push("second:start");
			return "second";
		});

		await Promise.resolve();
		expect(events).toEqual(["first:start"]);
		releaseFirst();
		await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
		expect(events).toEqual(["first:start", "first:end", "second:start"]);
	});

	it("does not serialize writes for different chapters", async () => {
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let secondStarted = false;

		const first = withChapterCanvasWriteQueue("chapter-a", async () => {
			await firstGate;
		});
		const second = withChapterCanvasWriteQueue("chapter-b", async () => {
			secondStarted = true;
		});

		await second;
		expect(secondStarted).toBe(true);
		releaseFirst();
		await first;
	});

	it("releases the chapter queue when a mutation fails", async () => {
		await expect(withChapterCanvasWriteQueue("chapter-failure", async () => {
			throw new Error("write failed");
		})).rejects.toThrow("write failed");

		await expect(withChapterCanvasWriteQueue(
			"chapter-failure",
			async () => "recovered",
		)).resolves.toBe("recovered");
	});
});

describe("waitForCanvasRevisionRetry", () => {
	it("does not impose a retry-count ceiling below the collection fan-out width", async () => {
		let clock = 10_000;
		const delays: number[] = [];
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const decision = await waitForCanvasRevisionRetry({
				attempt,
				deadlineMs: 70_000,
				now: () => clock,
				sleep: async (delayMs) => {
					delays.push(delayMs);
					clock += delayMs;
				},
			});
			expect(decision.retry).toBe(true);
		}

		expect(delays).toEqual([4, 8, 16, 32, 64, 128, 250, 250, 250, 250, 250, 250]);
	});

	it("backs off while the mutation deadline still permits a fresh CAS read", async () => {
		let clock = 1_000;
		const delays: number[] = [];
		const decision = await waitForCanvasRevisionRetry({
			attempt: 3,
			deadlineMs: 2_000,
			now: () => clock,
			sleep: async (delayMs) => {
				delays.push(delayMs);
				clock += delayMs;
			},
		});
		expect(decision).toEqual({ retry: true, delayMs: 32, attempt: 3, remainingMs: 968 });
		expect(delays).toEqual([32]);
	});

	it("does not turn an exhausted mutation deadline into another blind retry", async () => {
		const decision = await waitForCanvasRevisionRetry({
			attempt: 20,
			deadlineMs: 999,
			now: () => 1_000,
			sleep: async () => {
				throw new Error("sleep must not run after the deadline");
			},
		});
		expect(decision).toEqual({ retry: false, delayMs: 0, attempt: 20, remainingMs: 0 });
	});
});
