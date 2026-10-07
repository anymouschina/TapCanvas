import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
	workflow_node_runs: { findMany: vi.fn() },
	$queryRaw: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prismaMock }));

import { listNodeRunsForExecutionOwner, mapNodeRunRow } from "./execution.repo";

function nodeRun(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: "node-run-1",
		execution_id: "execution-1",
		node_id: "chapter-sequence",
		status: "running",
		attempt: 2,
		error_message: null,
		error_code: null,
		failure_stage: null,
		input_refs: null,
		output_refs: null,
		tool_calls: null,
		retry_count: 0,
		node_type: "agents.logical-task/v2",
		tool_name: null,
		model_key: "model-a",
		created_at: "2026-09-29T02:00:00.000Z",
		started_at: "2026-09-29T02:01:00.000Z",
		finished_at: null,
		...overrides,
	};
}

function progress(attempt: number) {
	return {
		version: 1,
		attempt,
		lastActivityAt: "2026-09-29T02:30:00.000Z",
		eventType: "tool",
		displayName: "章节编排",
		runtimeNodeId: "chapter-sequence::item::chapter-1",
		itemId: "chapter-1",
		itemIndex: 0,
		tool: { name: "Skill", phase: "completed", status: "succeeded" },
		streamedOutputChars: 0,
		observedEventCount: 12,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("current node-run Agent progress projection", () => {
	it("batch-loads only the owner-scoped execution's latest activity for the current attempt", async () => {
		prismaMock.workflow_node_runs.findMany.mockResolvedValueOnce([nodeRun()]);
		prismaMock.$queryRaw.mockResolvedValueOnce([
			{ node_id: "chapter-sequence", data: JSON.stringify(progress(2)) },
		]);

		const rows = await listNodeRunsForExecutionOwner({} as never, {
			ownerId: "owner-1",
			executionId: "execution-1",
		});
		const mapped = mapNodeRunRow(rows[0]!);
		expect(mapped.agentProgress).toEqual(progress(2));
		expect(mapped.outputRefs).toBeUndefined();
		expect(prismaMock.workflow_node_runs.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				execution_id: "execution-1",
				workflow_executions: { owner_id: "owner-1" },
			},
		}));
		expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
	});

	it("does not project an event from an older attempt even if a query result is stale", async () => {
		prismaMock.workflow_node_runs.findMany.mockResolvedValueOnce([nodeRun({ attempt: 3 })]);
		prismaMock.$queryRaw.mockResolvedValueOnce([
			{ node_id: "chapter-sequence", data: JSON.stringify(progress(2)) },
		]);

		const rows = await listNodeRunsForExecutionOwner({} as never, {
			ownerId: "owner-1",
			executionId: "execution-1",
		});
		expect(mapNodeRunRow(rows[0]!).agentProgress).toBeUndefined();
	});

	it("does not query activity events when the owner-scoped node-run query returns no rows", async () => {
		prismaMock.workflow_node_runs.findMany.mockResolvedValueOnce([]);
		const rows = await listNodeRunsForExecutionOwner({} as never, {
			ownerId: "other-owner",
			executionId: "execution-1",
		});
		expect(rows).toEqual([]);
		expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
	});
});
