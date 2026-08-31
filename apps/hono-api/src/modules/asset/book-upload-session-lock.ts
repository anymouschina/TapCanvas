import fs from "node:fs/promises";
import path from "node:path";

export class BookUploadSessionLockError extends Error {
	readonly code = "BOOK_UPLOAD_SESSION_LOCK_FAILED";
	readonly details: Readonly<Record<string, unknown>>;

	constructor(message: string, details: Readonly<Record<string, unknown>>) {
		super(message);
		this.name = "BookUploadSessionLockError";
		this.details = details;
	}
}

export type BookUploadSessionLockResult<T> =
	| { status: "busy" }
	| { status: "acquired"; value: T };

function readFileSystemErrorCode(error: unknown): string {
	if (!error || typeof error !== "object" || Array.isArray(error)) return "";
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : "";
}

function readErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : String(error);
}

async function releaseLock(input: {
	handle: Awaited<ReturnType<typeof fs.open>>;
	lockPath: string;
}): Promise<void> {
	const failures: Array<{ operation: "close" | "unlink"; reason: string }> = [];
	try {
		await input.handle.close();
	} catch (error) {
		failures.push({ operation: "close", reason: readErrorMessage(error) });
	}
	try {
		await fs.unlink(input.lockPath);
	} catch (error) {
		if (readFileSystemErrorCode(error) !== "ENOENT") {
			failures.push({ operation: "unlink", reason: readErrorMessage(error) });
		}
	}
	if (failures.length > 0) {
		throw new BookUploadSessionLockError(
			"释放书籍上传会话锁失败",
			{ lockPath: input.lockPath, failures },
		);
	}
}

export async function withBookUploadSessionLock<T>(input: {
	sessionMetaPath: string;
	operation: () => Promise<T>;
}): Promise<BookUploadSessionLockResult<T>> {
	const lockPath = `${input.sessionMetaPath}.lock`;
	await fs.mkdir(path.dirname(lockPath), { recursive: true });
	let handle: Awaited<ReturnType<typeof fs.open>>;
	try {
		handle = await fs.open(lockPath, "wx");
	} catch (error) {
		if (readFileSystemErrorCode(error) === "EEXIST") {
			return { status: "busy" };
		}
		throw new BookUploadSessionLockError(
			"获取书籍上传会话锁失败",
			{ lockPath, reason: readErrorMessage(error) },
		);
	}

	let value: T | undefined;
	let operationFailed = false;
	let operationError: unknown;
	try {
		value = await input.operation();
	} catch (error) {
		operationFailed = true;
		operationError = error;
	}

	let releaseFailed = false;
	let releaseError: unknown;
	try {
		await releaseLock({ handle, lockPath });
	} catch (error) {
		releaseFailed = true;
		releaseError = error;
	}

	if (operationFailed && releaseFailed) {
		throw new BookUploadSessionLockError(
			"书籍上传会话操作失败，且会话锁释放失败",
			{
				lockPath,
				operationReason: readErrorMessage(operationError),
				releaseReason: readErrorMessage(releaseError),
			},
		);
	}
	if (operationFailed) throw operationError;
	if (releaseFailed) throw releaseError;
	return { status: "acquired", value: value as T };
}
