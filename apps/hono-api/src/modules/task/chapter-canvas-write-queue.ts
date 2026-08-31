const chapterWriteTails = new Map<string, Promise<void>>();

export const DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS = 60_000;

export type ChapterCanvasRevisionRetryDecision = Readonly<{
	retry: boolean;
	delayMs: number;
	attempt: number;
	remainingMs: number;
}>;

/**
 * Cross-isolate serialization is owned by the database revision CAS. This
 * helper adds bounded contention backoff without turning an arbitrary retry
 * count into a correctness boundary. Every retry must re-read the durable
 * revision and rebuild its pure graph mutation.
 */
export async function waitForCanvasRevisionRetry(input: Readonly<{
	attempt: number;
	deadlineMs: number;
	now?: () => number;
	sleep?: (delayMs: number) => Promise<void>;
}>): Promise<ChapterCanvasRevisionRetryDecision> {
	const now = input.now ?? Date.now;
	const remainingMs = Math.max(0, input.deadlineMs - now());
	if (remainingMs === 0) {
		return { retry: false, delayMs: 0, attempt: input.attempt, remainingMs: 0 };
	}
	const exponentialDelayMs = Math.min(250, 4 * (2 ** Math.min(6, Math.max(0, input.attempt))));
	const delayMs = Math.min(exponentialDelayMs, remainingMs);
	await (input.sleep ?? ((durationMs) => new Promise<void>((resolve) => {
		setTimeout(resolve, durationMs);
	})))(delayMs);
	return {
		retry: input.deadlineMs > now(),
		delayMs,
		attempt: input.attempt,
		remainingMs: Math.max(0, input.deadlineMs - now()),
	};
}

/**
 * Serialize read-modify-write canvas patches for one chapter inside the current
 * worker isolate. Workflow collection items execute concurrently, but each
 * patch must read the revision produced by the preceding sibling before it can
 * build its merged graph. Database CAS remains the cross-isolate authority.
 */
export async function withChapterCanvasWriteQueue<T>(
	chapterId: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = chapterWriteTails.get(chapterId) ?? Promise.resolve();
	let releaseCurrent: () => void = () => undefined;
	const current = new Promise<void>((resolve) => {
		releaseCurrent = resolve;
	});
	const tail = previous.then(() => current);
	chapterWriteTails.set(chapterId, tail);

	await previous;
	try {
		return await operation();
	} finally {
		releaseCurrent();
		if (chapterWriteTails.get(chapterId) === tail) {
			chapterWriteTails.delete(chapterId);
		}
	}
}
