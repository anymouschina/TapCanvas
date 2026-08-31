const TRANSIENT_DATABASE_ERROR_CODES = new Set([
	"40P01", // PostgreSQL deadlock_detected
	"40001", // PostgreSQL serialization_failure
	"P2034", // Prisma transaction conflict / deadlock
]);

const DATABASE_ERROR_CONTAINER_KEYS = [
	"cause",
	"meta",
	"error",
	"databaseError",
	"dbError",
] as const;

export type DatabaseReadRetryDiagnostic = Readonly<{
	operation: string;
	attempt: number;
	maxAttempts: number;
	nextDelayMs: number;
	errorCodes: readonly string[];
}>;

type DatabaseReadRetryOptions = Readonly<{
	operation: string;
	maxAttempts?: number;
	baseDelayMs?: number;
	sleep?: (delayMs: number) => Promise<void>;
	onRetry?: (diagnostic: DatabaseReadRetryDiagnostic) => void;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectStructuredErrorCodes(
	value: unknown,
	codes: Set<string>,
	seen: Set<unknown>,
	depth: number,
): void {
	if (!isRecord(value) || seen.has(value) || depth > 5) return;
	seen.add(value);
	for (const key of ["code", "originalCode", "sqlState", "sqlstate"] as const) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim()) codes.add(candidate.trim());
	}
	for (const key of DATABASE_ERROR_CONTAINER_KEYS) {
		collectStructuredErrorCodes(value[key], codes, seen, depth + 1);
	}
}

/**
 * Prisma's driver-adapter path does not consistently expose PostgreSQL SQLSTATE
 * as `error.code`; some versions preserve it only in a nested cause or in the
 * rendered engine message. The fallback checks only the finite protocol-code
 * allowlist, never database prose or business semantics.
 */
export function readDatabaseErrorCodes(error: unknown): readonly string[] {
	const codes = new Set<string>();
	collectStructuredErrorCodes(error, codes, new Set<unknown>(), 0);
	const message = error instanceof Error
		? error.message
		: isRecord(error) && typeof error.message === "string"
			? error.message
			: "";
	for (const code of TRANSIENT_DATABASE_ERROR_CODES) {
		if (message.includes(code)) codes.add(code);
	}
	return [...codes].sort();
}

export function isTransientDatabaseReadError(error: unknown): boolean {
	return isTransientDatabaseConflictError(error);
}

/**
 * Structural database concurrency errors whose whole transaction can be
 * retried after PostgreSQL/Prisma has rolled the failed attempt back.
 */
export function isTransientDatabaseConflictError(error: unknown): boolean {
	return readDatabaseErrorCodes(error).some((code) => (
		TRANSIENT_DATABASE_ERROR_CODES.has(code)
	));
}

function defaultSleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Retries one side-effect-free database read. Callers must not wrap a compound
 * recovery routine or any provider/media operation with this helper: successful
 * earlier effects in such a routine would otherwise be replayed.
 */
export async function readDatabaseWithTransientRetry<T>(
	read: () => Promise<T>,
	options: DatabaseReadRetryOptions,
): Promise<T> {
	const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
	const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 25));
	const sleep = options.sleep ?? defaultSleep;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await read();
		} catch (error: unknown) {
			if (attempt >= maxAttempts || !isTransientDatabaseReadError(error)) throw error;
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
	throw new Error(`Database read retry exhausted unexpectedly: ${options.operation}`);
}
