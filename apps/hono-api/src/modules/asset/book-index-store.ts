import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type BookIndexRecord = Record<string, unknown>;

export type BookIndexStoreErrorCode =
	| "book_index_not_found"
	| "book_index_read_failed"
	| "book_index_parse_failed"
	| "book_index_invalid"
	| "book_index_identity_changed"
	| "book_index_lock_timeout"
	| "book_index_lock_failed"
	| "book_index_write_failed";

export class BookIndexStoreError extends Error {
	readonly code: BookIndexStoreErrorCode;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(
		message: string,
		input: {
			code: BookIndexStoreErrorCode;
			cause?: unknown;
			details?: Readonly<Record<string, unknown>>;
		},
	) {
		super(message, input.cause === undefined ? undefined : { cause: input.cause });
		this.name = "BookIndexStoreError";
		this.code = input.code;
		this.details = input.details ?? {};
	}
}

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 30_000;
const STALE_LOCK_MS = 10 * 60_000;
const processQueues = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is BookIndexRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function readNodeErrorCode(error: unknown): string {
	if (!isRecord(error)) return "";
	return typeof error.code === "string" ? error.code : "";
}

function wait(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function validateBookIndex(indexPath: string, value: unknown): asserts value is BookIndexRecord {
	if (!isRecord(value)) {
		throw new BookIndexStoreError("Book index must be a JSON object", {
			code: "book_index_invalid",
			details: { indexPath, reason: "top_level_not_object" },
		});
	}
	if (!readNonEmptyString(value.bookId)) {
		throw new BookIndexStoreError("Book index is missing bookId", {
			code: "book_index_invalid",
			details: { indexPath, reason: "book_id_missing" },
		});
	}
	if (!readNonEmptyString(value.projectId)) {
		throw new BookIndexStoreError("Book index is missing projectId", {
			code: "book_index_invalid",
			details: { indexPath, reason: "project_id_missing" },
		});
	}
	if (!Array.isArray(value.chapters)) {
		throw new BookIndexStoreError("Book index chapters must be an array", {
			code: "book_index_invalid",
			details: { indexPath, reason: "chapters_not_array" },
		});
	}
	if (value.assets !== undefined && !isRecord(value.assets)) {
		throw new BookIndexStoreError("Book index assets must be an object", {
			code: "book_index_invalid",
			details: { indexPath, reason: "assets_not_object" },
		});
	}
}

function assertIdentityUnchanged(
	indexPath: string,
	current: BookIndexRecord,
	next: BookIndexRecord,
): void {
	const currentBookId = readNonEmptyString(current.bookId);
	const nextBookId = readNonEmptyString(next.bookId);
	const currentProjectId = readNonEmptyString(current.projectId);
	const nextProjectId = readNonEmptyString(next.projectId);
	if (currentBookId !== nextBookId || currentProjectId !== nextProjectId) {
		throw new BookIndexStoreError("Book index identity cannot change during update", {
			code: "book_index_identity_changed",
			details: {
				indexPath,
				currentBookId,
				nextBookId,
				currentProjectId,
				nextProjectId,
			},
		});
	}
}

function parseBookIndex(indexPath: string, raw: string): BookIndexRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		throw new BookIndexStoreError("Book index JSON parsing failed", {
			code: "book_index_parse_failed",
			cause: error,
			details: { indexPath, reason: describeError(error), bytes: Buffer.byteLength(raw) },
		});
	}
	validateBookIndex(indexPath, parsed);
	return parsed;
}

async function readBookIndexUnlocked(indexPath: string): Promise<BookIndexRecord> {
	let raw: string;
	try {
		raw = await fs.readFile(indexPath, "utf8");
	} catch (error) {
		const nodeCode = readNodeErrorCode(error);
		throw new BookIndexStoreError(
			nodeCode === "ENOENT" ? "Book index not found" : "Book index read failed",
			{
				code: nodeCode === "ENOENT" ? "book_index_not_found" : "book_index_read_failed",
				cause: error,
				details: { indexPath, nodeCode, reason: describeError(error) },
			},
		);
	}
	return parseBookIndex(indexPath, raw);
}

async function acquireFileLock(indexPath: string): Promise<() => Promise<void>> {
	const lockPath = `${indexPath}.lock`;
	const startedAt = Date.now();
	for (;;) {
		try {
			const handle = await fs.open(lockPath, "wx");
			try {
				await handle.writeFile(
					JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
					"utf8",
				);
				await handle.sync();
			} finally {
				await handle.close();
			}
			return async () => {
				try {
					await fs.unlink(lockPath);
				} catch (error) {
					throw new BookIndexStoreError("Book index lock release failed", {
						code: "book_index_lock_failed",
						cause: error,
						details: {
							indexPath,
							lockPath,
							nodeCode: readNodeErrorCode(error),
							reason: describeError(error),
						},
					});
				}
			};
		} catch (error) {
			if (readNodeErrorCode(error) !== "EEXIST") {
				throw new BookIndexStoreError("Book index lock acquisition failed", {
					code: "book_index_lock_failed",
					cause: error,
					details: {
						indexPath,
						lockPath,
						nodeCode: readNodeErrorCode(error),
						reason: describeError(error),
					},
				});
			}
			const lockStat = await fs.stat(lockPath).catch(() => null);
			if (lockStat && Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
				console.warn("[book-index-store] removing stale lock", {
					indexPath,
					lockPath,
					lockAgeMs: Date.now() - lockStat.mtimeMs,
				});
				await fs.unlink(lockPath).catch(() => undefined);
				continue;
			}
			if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
				throw new BookIndexStoreError("Timed out waiting for book index lock", {
					code: "book_index_lock_timeout",
					details: { indexPath, lockPath, timeoutMs: LOCK_TIMEOUT_MS },
				});
			}
			await wait(LOCK_RETRY_MS);
		}
	}
}

async function withProcessQueue<T>(indexPath: string, operation: () => Promise<T>): Promise<T> {
	const previous = processQueues.get(indexPath) ?? Promise.resolve();
	let releaseQueue: () => void = () => undefined;
	const current = new Promise<void>((resolve) => {
		releaseQueue = () => resolve();
	});
	const tail = previous.then(() => current);
	processQueues.set(indexPath, tail);
	await previous;
	try {
		return await operation();
	} finally {
		releaseQueue();
		if (processQueues.get(indexPath) === tail) processQueues.delete(indexPath);
	}
}

async function withBookIndexLock<T>(indexPath: string, operation: () => Promise<T>): Promise<T> {
	return withProcessQueue(indexPath, async () => {
		await fs.mkdir(path.dirname(indexPath), { recursive: true });
		const releaseFileLock = await acquireFileLock(indexPath);
		let operationError: unknown;
		try {
			return await operation();
		} catch (error) {
			operationError = error;
			throw error;
		} finally {
			try {
				await releaseFileLock();
			} catch (releaseError) {
				if (operationError === undefined) throw releaseError;
				console.error("[book-index-store] lock release also failed", {
					indexPath,
					reason: describeError(releaseError),
				});
			}
		}
	});
}

async function writeBookIndexUnlocked(indexPath: string, next: BookIndexRecord): Promise<void> {
	validateBookIndex(indexPath, next);
	const serialized = `${JSON.stringify(next, null, 2)}\n`;
	const tempPath = `${indexPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
	let handle: FileHandle | null = null;
	try {
		handle = await fs.open(tempPath, "wx");
		await handle.writeFile(serialized, "utf8");
		await handle.sync();
		await handle.close();
		handle = null;
		const tempRaw = await fs.readFile(tempPath, "utf8");
		parseBookIndex(tempPath, tempRaw);
		await fs.rename(tempPath, indexPath);
		const persistedRaw = await fs.readFile(indexPath, "utf8");
		parseBookIndex(indexPath, persistedRaw);
	} catch (error) {
		throw error instanceof BookIndexStoreError
			? error
			: new BookIndexStoreError("Book index atomic write failed", {
					code: "book_index_write_failed",
					cause: error,
					details: {
						indexPath,
						tempPath,
						nodeCode: readNodeErrorCode(error),
						reason: describeError(error),
					},
			  });
	} finally {
		if (handle) await handle.close().catch(() => undefined);
		await fs.unlink(tempPath).catch(() => undefined);
	}
}

export async function readBookIndex(indexPath: string): Promise<BookIndexRecord> {
	return readBookIndexUnlocked(indexPath);
}

export async function replaceBookIndex(
	indexPath: string,
	next: BookIndexRecord,
): Promise<BookIndexRecord> {
	return withBookIndexLock(indexPath, async () => {
		validateBookIndex(indexPath, next);
		await writeBookIndexUnlocked(indexPath, next);
		return next;
	});
}

export async function updateBookIndex<T>(
	indexPath: string,
	updater: (current: Readonly<BookIndexRecord>) => {
		next: BookIndexRecord;
		result: T;
	},
): Promise<{ index: BookIndexRecord; result: T }> {
	return withBookIndexLock(indexPath, async () => {
		const current = await readBookIndexUnlocked(indexPath);
		const update = updater(structuredClone(current));
		validateBookIndex(indexPath, update.next);
		assertIdentityUnchanged(indexPath, current, update.next);
		await writeBookIndexUnlocked(indexPath, update.next);
		return { index: update.next, result: update.result };
	});
}

export async function upsertBookIndex<T>(
	indexPath: string,
	input: {
		create: () => { next: BookIndexRecord; result: T };
		update: (current: Readonly<BookIndexRecord>) => { next: BookIndexRecord; result: T };
	},
): Promise<{ index: BookIndexRecord; result: T; created: boolean }> {
	return withBookIndexLock(indexPath, async () => {
		let current: BookIndexRecord | null = null;
		try {
			current = await readBookIndexUnlocked(indexPath);
		} catch (error) {
			if (!(error instanceof BookIndexStoreError) || error.code !== "book_index_not_found") {
				throw error;
			}
		}
		const update = current ? input.update(structuredClone(current)) : input.create();
		validateBookIndex(indexPath, update.next);
		if (current) assertIdentityUnchanged(indexPath, current, update.next);
		await writeBookIndexUnlocked(indexPath, update.next);
		return { index: update.next, result: update.result, created: current === null };
	});
}
