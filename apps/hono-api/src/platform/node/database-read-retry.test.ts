import { describe, expect, it, vi } from "vitest";
import {
	isTransientDatabaseReadError,
	readDatabaseErrorCodes,
	readDatabaseWithTransientRetry,
} from "./database-read-retry";

describe("database read transient retry", () => {
	it("recognizes PostgreSQL SQLSTATE from nested driver evidence", () => {
		const error = { cause: { originalCode: "40P01" } };
		expect(readDatabaseErrorCodes(error)).toEqual(["40P01"]);
		expect(isTransientDatabaseReadError(error)).toBe(true);
	});

	it("recognizes Prisma's rendered SQLSTATE without matching database prose", () => {
		const error = new Error("ConnectorError(PostgresError { code: \"40001\" })");
		expect(readDatabaseErrorCodes(error)).toEqual(["40001"]);
		expect(isTransientDatabaseReadError(error)).toBe(true);
	});

	it("retries only the failed read and returns its eventual value", async () => {
		const read = vi.fn()
			.mockRejectedValueOnce({ code: "40P01" })
			.mockResolvedValue({ id: "execution-1" });
		const sleep = vi.fn().mockResolvedValue(undefined);
		const onRetry = vi.fn();
		await expect(readDatabaseWithTransientRetry(read, {
			operation: "workflow_execution_recovery_snapshot",
			sleep,
			onRetry,
		})).resolves.toEqual({ id: "execution-1" });
		expect(read).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(25);
		expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
			operation: "workflow_execution_recovery_snapshot",
			attempt: 1,
			errorCodes: ["40P01"],
		}));
	});

	it("does not retry a non-transient failure", async () => {
		const error = Object.assign(new Error("permission denied"), { code: "42501" });
		const read = vi.fn().mockRejectedValue(error);
		const sleep = vi.fn().mockResolvedValue(undefined);
		await expect(readDatabaseWithTransientRetry(read, {
			operation: "workflow_execution_recovery_snapshot",
			sleep,
		})).rejects.toBe(error);
		expect(read).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("preserves the final transient failure after the bounded budget", async () => {
		const error = { meta: { code: "P2034" } };
		const read = vi.fn().mockRejectedValue(error);
		const sleep = vi.fn().mockResolvedValue(undefined);
		await expect(readDatabaseWithTransientRetry(read, {
			operation: "workflow_execution_recovery_snapshot",
			maxAttempts: 3,
			sleep,
		})).rejects.toBe(error);
		expect(read).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenNthCalledWith(1, 25);
		expect(sleep).toHaveBeenNthCalledWith(2, 50);
	});
});
