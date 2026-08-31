import { describe, expect, it, vi } from "vitest";
import { runDatabaseTransactionWithTransientRetry } from "./database-transaction-retry";

describe("database transaction transient retry", () => {
	it("replays a fully rolled-back transaction after a Prisma P2034 conflict", async () => {
		const transaction = vi.fn()
			.mockRejectedValueOnce({ code: "P2034" })
			.mockResolvedValue({ terminalized: false });
		const sleep = vi.fn().mockResolvedValue(undefined);
		const onRetry = vi.fn();

		await expect(runDatabaseTransactionWithTransientRetry(transaction, {
			operation: "continuation_settlement",
			sleep,
			onRetry,
		})).resolves.toEqual({ terminalized: false });
		expect(transaction).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(20);
		expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
			operation: "continuation_settlement",
			attempt: 1,
			errorCodes: ["P2034"],
		}));
	});

	it("does not replay a transaction after a non-concurrency error", async () => {
		const error = Object.assign(new Error("permission denied"), { code: "42501" });
		const transaction = vi.fn().mockRejectedValue(error);
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(runDatabaseTransactionWithTransientRetry(transaction, {
			operation: "continuation_settlement",
			sleep,
		})).rejects.toBe(error);
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("preserves the final conflict after the bounded retry budget", async () => {
		const error = { cause: { originalCode: "40001" } };
		const transaction = vi.fn().mockRejectedValue(error);
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(runDatabaseTransactionWithTransientRetry(transaction, {
			operation: "continuation_settlement",
			maxAttempts: 3,
			sleep,
		})).rejects.toBe(error);
		expect(transaction).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenNthCalledWith(1, 20);
		expect(sleep).toHaveBeenNthCalledWith(2, 40);
	});
});
