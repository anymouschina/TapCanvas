/** Coalesce pending cumulative snapshots, acknowledging only committed writes. */
export function createCheckpointWriter<T>(write: (snapshot: T) => Promise<void>) {
	type Waiter = { resolve: () => void; reject: (error: unknown) => void };
	let pending: { snapshot: () => T; waiters: Waiter[] } | null = null;
	let running = false;
	let failure: { error: unknown } | null = null;
	const drain = async (): Promise<void> => {
		while (pending) {
			const batch = pending;
			pending = null;
			try {
				await write(batch.snapshot());
				for (const waiter of batch.waiters) waiter.resolve();
			} catch (error: unknown) {
				failure = { error };
				for (const waiter of batch.waiters) waiter.reject(error);
				// Calls admitted while the write was in flight must also fail.
				const queued = pending as { snapshot: () => T; waiters: Waiter[] } | null;
				pending = null;
				for (const waiter of queued?.waiters ?? []) waiter.reject(error);
				break;
			}
		}
		running = false;
	};
	return (snapshot: () => T): Promise<void> => {
		if (failure) return Promise.reject(failure.error);
		const result = new Promise<void>((resolve, reject) => {
			const waiters = pending?.waiters ?? [];
			waiters.push({ resolve, reject });
			pending = { snapshot, waiters };
		});
		if (!running) {
			running = true;
			queueMicrotask(() => { void drain(); });
		}
		return result;
	};
}
