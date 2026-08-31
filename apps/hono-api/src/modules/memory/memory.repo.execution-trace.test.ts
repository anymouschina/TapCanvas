import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../types";

const dbMocks = vi.hoisted(() => ({
	execute: vi.fn(async (): Promise<void> => {
		const error = new Error("database unavailable") as Error & { code: string };
		error.code = "db_unavailable";
		throw error;
	}),
	queryAll: vi.fn(async (): Promise<unknown[]> => []),
	queryOne: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("../../db/db", () => dbMocks);

import { writeExecutionTrace } from "./memory.repo";

describe("writeExecutionTrace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reports schema initialization failure as degraded without throwing", async () => {
		const result = await writeExecutionTrace({} as unknown as PrismaClient, "user-1", {
			scopeType: "project",
			scopeId: "project-1",
			requestKind: "agents_bridge:chat",
			inputSummary: "structural summary",
		});
		expect(result.status).toBe("degraded");
		expect(result.errorCode).toBe("execution_trace_schema_not_ready");
	});

	it("reports structural sanitization failure as degraded before touching the database", async () => {
		const unreadableMeta = new Proxy<Record<string, unknown>>({}, {
			ownKeys: () => {
				throw new Error("unreadable trace payload");
			},
		});
		const result = await writeExecutionTrace({} as unknown as PrismaClient, "user-1", {
			scopeType: "project",
			scopeId: "project-1",
			requestKind: "agents_bridge:chat",
			inputSummary: "structural summary",
			meta: unreadableMeta,
		});
		expect(result.status).toBe("degraded");
		expect(result.errorCode).toBe("execution_trace_write_failed");
		expect(dbMocks.execute).not.toHaveBeenCalled();
	});
});
