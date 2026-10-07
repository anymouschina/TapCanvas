import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMocks = vi.hoisted(() => ({
	claimQueuedExecutionStart: vi.fn(),
	ensureNodeRuns: vi.fn(),
	incrementNodeRunAttempt: vi.fn(),
	insertExecutionEvent: vi.fn(),
	updateExecutionStatus: vi.fn(),
	updateNodeRun: vi.fn(),
	updateNodeRuns: vi.fn(),
}));
const prismaMock = vi.hoisted(() => ({
	workflow_executions: { findUnique: vi.fn() },
}));

vi.mock("./execution.repo", () => repoMocks);
vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prismaMock }));

import type { WorkerEnv } from "../../types";
import { ExecutionDO } from "./execution.do";

const NODE_ID = "chapter-sequence";
const NODE_RUN_ID = "node-run-1";
const EXECUTION_ID = "execution-1";

function activity(attempt: number, lastActivityAt = "2026-09-29T02:30:00.000Z") {
	return {
		version: 1,
		attempt,
		lastActivityAt,
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

function createExecution(input: Readonly<{
	status?: string;
	attempt?: number;
	latestActivity?: ReturnType<typeof activity> | null;
}> = {}) {
	const nodeRunStatus = input.status ?? "running";
	const attempt = input.attempt ?? 2;
	const db = {
		workflow_node_runs: {
			findUnique: vi.fn(async () => ({
				id: NODE_RUN_ID,
				attempt,
				status: nodeRunStatus,
				output_refs: null,
			})),
		},
		workflow_execution_events: {
			findFirst: vi.fn(async () => input.latestActivity
				? { data: JSON.stringify(input.latestActivity) }
				: null),
		},
	};
	const state = {
		id: { toString: () => EXECUTION_ID },
		storage: {
			get: vi.fn(async () => ({
				status: "running",
				indeg: { [NODE_ID]: 0 },
				requiredInputPorts: {},
				activeInputPorts: {},
			})),
			put: vi.fn(),
		},
	};
	return { execution: new ExecutionDO(state as never, { DB: db } as unknown as WorkerEnv), db };
}

function activityRequest(progress: ReturnType<typeof activity>, attempt = progress.attempt) {
	return new Request("https://do/nodeProgress", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			progressKind: "agent_activity",
			nodeId: NODE_ID,
			nodeRunId: NODE_RUN_ID,
			attempt,
			agentProgress: progress,
		}),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	repoMocks.insertExecutionEvent.mockResolvedValue(7);
	prismaMock.workflow_executions.findUnique.mockResolvedValue({ project_id: null });
});

describe("durable Agent activity progress fence", () => {
	it("appends activity separately without changing node output receipts", async () => {
		const { execution, db } = createExecution();
		const response = await execution.fetch(activityRequest(activity(2)));
		expect(response.status).toBe(202);
		expect(repoMocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			executionId: EXECUTION_ID,
			eventType: "node_agent_activity",
			nodeId: NODE_ID,
			data: activity(2),
		}));
		expect(repoMocks.updateNodeRun).not.toHaveBeenCalled();
		expect(db.workflow_node_runs.findUnique).toHaveBeenCalledTimes(1);
	});

	it("ignores an older timestamp for the same attempt", async () => {
		const { execution, db } = createExecution({
			latestActivity: activity(2, "2026-09-29T02:31:00.000Z"),
		});
		const response = await execution.fetch(activityRequest(activity(2, "2026-09-29T02:30:00.000Z")));
		expect(db.workflow_execution_events.findFirst).toHaveBeenCalledTimes(1);
		const latestEvent = await db.workflow_execution_events.findFirst.mock.results[0]?.value;
		expect(latestEvent).toEqual({ data: JSON.stringify(activity(2, "2026-09-29T02:31:00.000Z")) });
		expect(response.status).toBe(204);
		expect(repoMocks.insertExecutionEvent).not.toHaveBeenCalled();
	});

	it("fences a stale attempt before persisting its activity", async () => {
		const { execution } = createExecution({ attempt: 3 });
		const response = await execution.fetch(activityRequest(activity(2)));
		expect(response.status).toBe(208);
		expect(repoMocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_stale_attempt_ignored",
		}));
		expect(repoMocks.insertExecutionEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_agent_activity",
		}));
	});

	it("rejects activity after the node run becomes terminal", async () => {
		const { execution } = createExecution({ status: "success" });
		const response = await execution.fetch(activityRequest(activity(2)));
		expect(response.status).toBe(208);
		expect(repoMocks.insertExecutionEvent).not.toHaveBeenCalled();
	});
});
