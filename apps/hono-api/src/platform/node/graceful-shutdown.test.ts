import { describe, expect, it, vi } from "vitest";
import { waitForGracefulShutdown } from "./graceful-shutdown";

describe("graceful shutdown deadline", () => {
	it("reports a completed framework close", async () => {
		await expect(waitForGracefulShutdown(async () => undefined, 50)).resolves.toBe("closed");
	});

	it("reports a deadline instead of leaving a drained process pending forever", async () => {
		vi.useFakeTimers();
		try {
			const outcome = waitForGracefulShutdown(
				() => new Promise(() => undefined),
				1_000,
			);
			await vi.advanceTimersByTimeAsync(1_000);
			await expect(outcome).resolves.toBe("deadline_exceeded");
		} finally {
			vi.useRealTimers();
		}
	});
});
