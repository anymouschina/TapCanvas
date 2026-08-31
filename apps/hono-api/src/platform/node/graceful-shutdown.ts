export type GracefulShutdownOutcome = "closed" | "deadline_exceeded";

/**
 * Bounds framework shutdown so an open SSE/WebSocket connection cannot leave
 * a drained API process alive forever. The caller owns the final exit status.
 */
export async function waitForGracefulShutdown(
	close: () => Promise<unknown>,
	deadlineMs: number,
): Promise<GracefulShutdownOutcome> {
	const boundedDeadlineMs = Math.max(1, Math.floor(deadlineMs));
	let timer: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			close().then(() => "closed" as const),
			new Promise<"deadline_exceeded">((resolve) => {
				timer = setTimeout(() => resolve("deadline_exceeded"), boundedDeadlineMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
