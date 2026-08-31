import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../types";
import {
	assertTaskPersistenceIntegrity,
	TaskPersistenceIntegrityError,
} from "./task-persistence-integrity";

type QueryResult = readonly unknown[];

function createDatabase(queryResults: readonly QueryResult[]): {
	database: PrismaClient;
	executeRawUnsafe: ReturnType<typeof vi.fn>;
	queryRaw: ReturnType<typeof vi.fn>;
} {
	const executeRawUnsafe = vi.fn().mockResolvedValue(0);
	const queryRaw = vi.fn();
	for (const result of queryResults) queryRaw.mockResolvedValueOnce(result);
	const transaction = { $executeRawUnsafe: executeRawUnsafe, $queryRaw: queryRaw };
	const database = {
		$transaction: vi.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
			operation(transaction)),
	} as unknown as PrismaClient;
	return { database, executeRawUnsafe, queryRaw };
}

const healthyIndexes = [
	{
		index_name: "task_results_pkey",
		indisunique: true,
		indisvalid: true,
		indisready: true,
		indislive: true,
	},
	{
		index_name: "task_statuses_task_id_provider_key",
		indisunique: true,
		indisvalid: true,
		indisready: true,
		indislive: true,
	},
];

describe("assertTaskPersistenceIntegrity", () => {
	it("accepts unique heap identities backed by healthy indexes", async () => {
		const { database, executeRawUnsafe, queryRaw } = createDatabase([[], healthyIndexes]);

		await expect(assertTaskPersistenceIntegrity(database)).resolves.toBeUndefined();

		expect(executeRawUnsafe).toHaveBeenCalledTimes(3);
		expect(queryRaw).toHaveBeenCalledTimes(2);
	});

	it("fails before worker registration when a heap identity is duplicated", async () => {
		const { database, queryRaw } = createDatabase([[
			{
				table_name: "task_results",
				identity_key: "user-1:task-1",
				duplicate_count: 2,
			},
		]]);

		await expect(assertTaskPersistenceIntegrity(database)).rejects.toMatchObject({
			name: "TaskPersistenceIntegrityError",
			code: "task_persistence_identity_corrupt",
		});
		expect(queryRaw).toHaveBeenCalledTimes(1);
	});

	it("fails when a required identity index is absent or unhealthy", async () => {
		const { database } = createDatabase([[], [healthyIndexes[0]]]);

		await expect(assertTaskPersistenceIntegrity(database)).rejects.toEqual(
			expect.objectContaining<TaskPersistenceIntegrityError>({
				message: expect.stringContaining("task_statuses_task_id_provider_key"),
			}),
		);
	});
});
