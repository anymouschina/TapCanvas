import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../types";

const dbMocks = vi.hoisted(() => ({
	queryAll: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("../../db/db", () => ({
	execute: vi.fn(),
	queryAll: dbMocks.queryAll,
	queryOne: vi.fn(),
}));

vi.mock("./execution-trace-schema", () => ({
	assertExecutionTraceSchemaReady: vi.fn(async (): Promise<void> => undefined),
}));

import { listExecutionTraces } from "./memory.repo";

describe("listExecutionTraces", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("applies an exact owned trace id filter for Agent API job diagnostics", async () => {
		await listExecutionTraces({} as unknown as PrismaClient, {
			userId: "user-1",
			traceId: "job-1",
			requestKindPrefix: "agents_bridge:",
			limit: 50,
		});

		expect(dbMocks.queryAll).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining("user_id = ? AND id = ? AND request_kind LIKE ?"),
			["user-1", "job-1", "agents_bridge:%", 50],
		);
	});

	it("loads every physical trace in an owned logical execution family", async () => {
		await listExecutionTraces({} as unknown as PrismaClient, {
			userId: "user-1",
			traceFamilyId: "job-1",
			requestKindPrefix: "agents_bridge:",
			limit: 50,
		});

		expect(dbMocks.queryAll).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining(
				"user_id = ? AND (id = ? OR root_trace_id = ? OR logical_task_id = ?) AND request_kind LIKE ?",
			),
			["user-1", "job-1", "job-1", "job-1", "agents_bridge:%", 50],
		);
	});
});
