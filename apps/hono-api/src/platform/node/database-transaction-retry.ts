import {
	isTransientDatabaseConflictError,
	readDatabaseErrorCodes,
} from "./database-read-retry";

export type DatabaseTransactionRetryDiagnostic = Readonly<{
	operation: string;
	attempt: number;
	maxAttempts: number;
	nextDelayMs: number;
	errorCodes: readonly string[];
}>;

export type DatabaseTransactionRetryOptions = Readonly<{
	operation: string;
	maxAttempts?: number;
	baseDelayMs?: number;
	sleep?: (delayMs: number) => Promise<void>;
	onRetry?: (diagnostic: DatabaseTransactionRetryDiagnostic) => void;
}>;

function defaultSleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Replays one database-only transaction after a serialization conflict or
 * deadlock. The callback must not perform provider calls, billing or other
 * external effects: PostgreSQL guarantees rollback only for database writes.
 */
export async function runDatabaseTransactionWithTransientRetry<T>(
	transaction: () => Promise<T>,
	options: DatabaseTransactionRetryOptions,
): Promise<T> {
	const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
	const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 20));
	const sleep = options.sleep ?? defaultSleep;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await transaction();
		} catch (error: unknown) {
			if (attempt >= maxAttempts || !isTransientDatabaseConflictError(error)) throw error;
			const nextDelayMs = baseDelayMs * attempt;
			options.onRetry?.({
				operation: options.operation,
				attempt,
				maxAttempts,
				nextDelayMs,
				errorCodes: readDatabaseErrorCodes(error),
			});
			await sleep(nextDelayMs);
		}
	}
	throw new Error(`Database transaction retry exhausted unexpectedly: ${options.operation}`);
}
