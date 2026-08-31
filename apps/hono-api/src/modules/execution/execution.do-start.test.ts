import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableObjectState } from "@cloudflare/workers-types";
import type { WorkerEnv } from "../../types";

const mocks = vi.hoisted(() => ({
	findExecution: vi.fn(async () => ({
		id: "execution-1",
		flow_version_id: "version-1",
		status: "queued",
		concurrency: 1,
	})),
	findVersion: vi.fn(async () => ({ data: JSON.stringify({ nodes: [], edges: [] }) })),
	claim: vi.fn(async () => true),
	updateExecutionStatus: vi.fn(async () => undefined),
	ensureNodeRuns: vi.fn(async () => undefined),
	insertExecutionEvent: vi.fn(async (_db: unknown, _params: Readonly<Record<string, unknown>>) => undefined),
	updateNodeRun: vi.fn(async (_db: unknown, _params: Readonly<Record<string, unknown>>) => undefined),
	findNodeRun: vi.fn(async () => ({ id: "node-run-1", attempt: 1, status: "running" })),
	findNodeRuns: vi.fn(async () => [
		{ node_id: "running-agent", status: "running", output_refs: null },
		{ node_id: "queued-output", status: "queued", output_refs: null },
	]),
	findLatestEvent: vi.fn(async () => ({ seq: 7, created_at: "2026-08-22T21:10:30.000Z" })),
	updateNodeRunDirect: vi.fn(async () => undefined),
	updateNodeRunsDirect: vi.fn(async () => ({ count: 2 })),
	updateNodeRunsLedger: vi.fn(async () => undefined),
	incrementNodeRunAttempt: vi.fn(async () => 2),
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		workflow_executions: { findUnique: mocks.findExecution },
		flow_versions: { findUnique: mocks.findVersion },
		workflow_node_runs: {
			findUnique: mocks.findNodeRun,
			findMany: mocks.findNodeRuns,
			update: mocks.updateNodeRunDirect,
			updateMany: mocks.updateNodeRunsDirect,
		},
		workflow_execution_events: { findFirst: mocks.findLatestEvent },
	}),
}));
vi.mock("./execution.repo", () => ({
	claimQueuedExecutionStart: mocks.claim,
	ensureNodeRuns: mocks.ensureNodeRuns,
	insertExecutionEvent: mocks.insertExecutionEvent,
	updateExecutionStatus: mocks.updateExecutionStatus,
	updateNodeRun: mocks.updateNodeRun,
	updateNodeRuns: mocks.updateNodeRunsLedger,
	incrementNodeRunAttempt: mocks.incrementNodeRunAttempt,
}));

import { ExecutionDO } from "./execution.do";
import { freezeWorkflowExecutionSemanticsSnapshot } from "./execution.semantics-snapshot";

function state(initialGraph?: unknown): DurableObjectState {
	const values = new Map<string, unknown>();
	if (initialGraph !== undefined) values.set("graph", initialGraph);
	return {
		id: { toString: () => "execution-1" },
		storage: {
			get: vi.fn(async (key: string) => values.get(key)),
			put: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
		},
	} as unknown as DurableObjectState;
}

function env(): WorkerEnv {
	return {
		DB: {
			workflow_node_runs: {
				findUnique: mocks.findNodeRun,
				findMany: vi.fn(async () => []),
			},
		},
		JWT_SECRET: "test",
		WORKFLOW_NODE_QUEUE: { send: vi.fn() },
	} as unknown as WorkerEnv;
}

describe("ExecutionDO start claim", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockClear();
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "queued",
			concurrency: 1,
		});
		mocks.claim.mockResolvedValue(true);
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running" });
		mocks.findNodeRuns.mockResolvedValue([
			{ node_id: "running-agent", status: "running", output_refs: null },
			{ node_id: "queued-output", status: "queued", output_refs: null },
		]);
		mocks.findLatestEvent.mockResolvedValue({ seq: 7, created_at: "2026-08-22T21:10:30.000Z" });
	});

	it("claims queued state before graph initialization", async () => {
		const response = await new ExecutionDO(state(), env()).fetch(new Request("https://do/start", { method: "POST" }));
		expect(response.status).toBe(200);
		expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ executionId: "execution-1" }));
		expect(mocks.findVersion).toHaveBeenCalledTimes(1);
	});

	it("returns an idempotent response when another scanner owns the start claim", async () => {
		mocks.claim.mockResolvedValue(false);
		const response = await new ExecutionDO(state(), env()).fetch(new Request("https://do/start", { method: "POST" }));
		expect(response.status).toBe(208);
		expect(mocks.findVersion).not.toHaveBeenCalled();
	});

	it("returns an idempotent response for an already running execution", async () => {
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "running",
			concurrency: 1,
		});
		const response = await new ExecutionDO(state(), env()).fetch(new Request("https://do/start", { method: "POST" }));
		expect(response.status).toBe(208);
		expect(mocks.claim).not.toHaveBeenCalled();
	});

	it("rebuilds formerly ambiguous queued rows through the DAG before redispatch", async () => {
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "running",
			concurrency: 1,
		});
		mocks.findVersion.mockResolvedValue({
			data: JSON.stringify({
				nodes: [{ id: "queued-agent", data: {} }],
				edges: [],
			}),
		});
		mocks.findNodeRuns
			.mockResolvedValueOnce([{ node_id: "queued-agent", status: "queued", output_refs: null }])
			.mockResolvedValueOnce([{ node_id: "queued-agent", status: "pending", output_refs: null }]);
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "queued" });
		const runtime = env();

		const response = await new ExecutionDO(state(), runtime).fetch(new Request("https://do/recoverAfterRestart", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				recoverableNodeIds: [],
				unsafeNodeIds: [],
				recoveryReason: "process_startup",
			}),
		}));

		expect(response.status).toBe(200);
		expect(mocks.updateNodeRunsLedger).toHaveBeenCalledWith(expect.anything(), {
			executionId: "execution-1",
			nodeIds: ["queued-agent"],
			update: { status: "pending" },
		});
		expect(runtime.WORKFLOW_NODE_QUEUE?.send).toHaveBeenCalledWith({
			executionId: "execution-1",
			nodeId: "queued-agent",
			nodeRunId: "node-run-1",
			attempt: 1,
		});
	});

	it("rejects a stale local abandonment scan when durable ownership is still fresh", async () => {
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "running",
			concurrency: 1,
		});
		mocks.findVersion.mockResolvedValue({
			data: JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
				nodes: [{
					id: "running-agent",
					type: "taskNode",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: { executorRef: "agents.logical-task/v2" },
					},
				}],
				edges: [],
			})),
		});
		mocks.findNodeRuns.mockResolvedValue([
			{ node_id: "running-agent", status: "running", output_refs: null },
		]);
		mocks.findLatestEvent.mockResolvedValue({
			seq: 8,
			created_at: "2026-08-22T21:10:30.000Z",
		});

		const response = await new ExecutionDO(state(), env()).fetch(new Request("https://do/recoverAfterRestart", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				recoverableNodeIds: ["running-agent"],
				unsafeNodeIds: [],
				recoveryReason: "local_abandonment",
				ownershipStaleBefore: "2026-08-22T21:10:00.000Z",
			}),
		}));

		expect(response.status).toBe(208);
		await expect(response.json()).resolves.toMatchObject({
			recovered: 0,
			ownershipStillActive: true,
		});
		expect(mocks.incrementNodeRunAttempt).not.toHaveBeenCalled();
		expect(mocks.updateNodeRunsLedger).not.toHaveBeenCalled();
	});

	it("rehydrates a missing scheduler graph before an external check", async () => {
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "running",
			concurrency: 1,
		});
		mocks.findVersion.mockResolvedValue({
			data: JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
				nodes: [{
					id: "waiting-agent",
					type: "taskNode",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: { executorRef: "agents.logical-task/v2" },
					},
				}],
				edges: [],
			})),
		});
		mocks.findNodeRun.mockResolvedValue({
			id: "node-run-1",
			attempt: 1,
			status: "waiting_external",
		});
		mocks.findNodeRuns.mockResolvedValue([
			{ node_id: "waiting-agent", status: "waiting_external", output_refs: null },
		]);

		const response = await new ExecutionDO(state(), env()).fetch(new Request("https://do/nodeExternalCheckStarted", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				nodeId: "waiting-agent",
				nodeRunId: "node-run-1",
				attempt: 1,
			}),
		}));

		expect(response.status).toBe(202);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), {
			executionId: "execution-1",
			nodeId: "waiting-agent",
			status: "running",
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			finishedAt: null,
		});
	});

	it("persists factual per-item progress while an each node is still running", async () => {
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 1,
			ready: [],
			indeg: { "prompt-agent": 0 },
			adj: { "prompt-agent": [] },
		});
		const outputRefs = {
			protocolVersion: "1",
			executorRef: "agents.logical-task/v2",
			nodeId: "prompt-agent",
			executionMode: "each",
			ports: {},
			artifacts: [],
			evidence: {
				executorCompleted: false,
				completedItems: 1,
				failedItems: 0,
				settledItems: 1,
				totalItems: 19,
			},
			itemRuns: [{
				itemId: "segment-0001",
				index: 0,
				status: "success",
				runtimeNodeId: "prompt-agent::item::segment-0001",
				lineage: [],
				ports: { result: { text: "15 秒提示词" } },
				artifacts: [],
				evidence: {},
			}],
		};
		const response = await new ExecutionDO(executionState, env()).fetch(new Request("https://do/nodeProgress", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId: "prompt-agent", nodeRunId: "node-run-1", attempt: 1, outputRefs }),
		}));

		expect(response.status).toBe(202);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			executionId: "execution-1",
			nodeId: "prompt-agent",
			status: "running",
			outputRefs,
		}));
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			executionId: "execution-1",
			eventType: "node_progress",
			data: expect.objectContaining({ completedItems: 1, settledItems: 1, totalItems: 19 }),
		}));
	});

	it("does not reserve a second concurrency slot when a scheduled recovery starts", async () => {
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "running",
			concurrency: 1,
		});
		mocks.findVersion.mockResolvedValue({
			data: JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
				nodes: [{
					id: "recovering-agent",
					data: { workflowAtomicSpec: { executorRef: "agents.logical-task/v2" } },
				}],
				edges: [],
			})),
		});
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "queued" });
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 1,
			ready: [],
			indeg: { "recovering-agent": 0 },
			adj: { "recovering-agent": [] },
		});

		const response = await new ExecutionDO(executionState, env()).fetch(new Request("https://do/nodeRecoveryStarted", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId: "recovering-agent", nodeRunId: "node-run-1", attempt: 1 }),
		}));

		expect(response.status).toBe(202);
		await expect(executionState.storage.get("graph")).resolves.toMatchObject({ running: 1 });
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), {
			executionId: "execution-1",
			nodeId: "recovering-agent",
			status: "running",
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			finishedAt: null,
		});
	});

	it("finishes a durable queued intent reservation when dispatch survived before graph persistence", async () => {
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "queued" });
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 0,
			ready: ["queued-agent"],
			indeg: { "queued-agent": 0 },
			adj: { "queued-agent": [] },
		});

		const response = await new ExecutionDO(executionState, env()).fetch(new Request("https://do/nodeStarted", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId: "queued-agent", nodeRunId: "node-run-1", attempt: 1 }),
		}));

		expect(response.status).toBe(202);
		await expect(executionState.storage.get("graph")).resolves.toMatchObject({
			running: 1,
			ready: [],
		});
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), {
			executionId: "execution-1",
			nodeId: "queued-agent",
			status: "running",
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			startedAt: expect.any(String),
			finishedAt: null,
		});
	});

	it("renews ownership only for the exact currently running node attempt", async () => {
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 3, status: "running" });
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 1,
			ready: [],
			indeg: { "long-agent": 0 },
			adj: { "long-agent": [] },
		});

		const response = await new ExecutionDO(executionState, env()).fetch(new Request("https://do/nodeHeartbeat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId: "long-agent", nodeRunId: "node-run-1", attempt: 3 }),
		}));

		expect(response.status).toBe(202);
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_heartbeat",
			level: "debug",
			nodeId: "long-agent",
			data: { nodeRunId: "node-run-1", attempt: 3 },
		}));
	});

	it("rejects a stale heartbeat without renewing the current attempt", async () => {
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 4, status: "running" });
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 1,
			ready: [],
			indeg: { "long-agent": 0 },
			adj: { "long-agent": [] },
		});

		const response = await new ExecutionDO(executionState, env()).fetch(new Request("https://do/nodeHeartbeat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId: "long-agent", nodeRunId: "node-run-1", attempt: 3 }),
		}));

		expect(response.status).toBe(208);
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_stale_attempt_ignored",
			nodeId: "long-agent",
		}));
		expect(mocks.insertExecutionEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_heartbeat",
		}));
	});

	it("seeds a validated pinned output and queues only its newly unblocked successor", async () => {
		const pinnedOutput = {
			protocolVersion: "1",
			executorRef: "workflow.trigger/v1",
			nodeId: "trigger",
			executionMode: "once",
			ports: { trigger: { occurredAt: "2026-08-12T00:00:00.000Z" } },
			artifacts: [],
			evidence: { executorCompleted: true, outputReuse: { version: 1, kind: "pin" } },
			itemRuns: [],
		};
		mocks.findVersion.mockResolvedValueOnce({
			data: JSON.stringify({
				nodes: [
					{
						id: "trigger",
						type: "taskNode",
						data: {
							kind: "workflowTrigger",
							workflowAtomicSpec: {
								executorRef: "workflow.trigger/v1",
								executionMode: "once",
								outputPorts: ["trigger"],
							},
							workflowResolvedOutputReuse: {
								version: 1,
								kind: "pin",
								sourceExecutionId: "source-execution",
								sourceNodeRunId: "source-run",
								outputRefs: pinnedOutput,
							},
						},
					},
					{
						id: "output",
						type: "taskNode",
						data: {
							kind: "workflowOutput",
							workflowAtomicSpec: {
								executorRef: "workflow.output/v1",
								executionMode: "once",
								inputPorts: ["trigger"],
								outputPorts: ["result"],
							},
						},
					},
				],
				edges: [{
					id: "trigger-to-output",
					source: "trigger",
					target: "output",
					sourceHandle: "out-workflow:trigger",
					targetHandle: "in-workflow:trigger",
				}],
			}),
		});
		const runtime = env();
		const response = await new ExecutionDO(state(), runtime).fetch(new Request("https://do/start", { method: "POST" }));

		expect(response.status).toBe(200);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			nodeId: "trigger",
			status: "success",
			outputRefs: pinnedOutput,
		}));
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_output_reused",
			nodeId: "trigger",
			data: expect.objectContaining({ kind: "pin", sourceExecutionId: "source-execution" }),
		}));
		expect(runtime.WORKFLOW_NODE_QUEUE?.send).toHaveBeenCalledWith({
			executionId: "execution-1",
			nodeId: "output",
			nodeRunId: "node-run-1",
			attempt: 1,
		});
	});

	it("seeds a replay checkpoint as pending work before the scheduler dispatches it", async () => {
		const checkpointOutput = {
			protocolVersion: "1",
			executorRef: "agents.logical-task/v2",
			nodeId: "prompt-agent",
			executionMode: "each",
			ports: {},
			artifacts: [],
			evidence: {
				executorCompleted: false,
				completedItems: 1,
				replayCheckpoint: { version: 1, kind: "replay_checkpoint" },
			},
			itemRuns: [{
				itemId: "clip-01",
				index: 0,
				status: "success",
				runtimeNodeId: "prompt-agent::item::clip-01",
				lineage: [],
				ports: { result: { prompt: "已完成" } },
				artifacts: [],
				evidence: { taskId: "turn-01" },
			}],
		};
		mocks.findVersion.mockResolvedValueOnce({
			data: JSON.stringify({
				nodes: [{
					id: "prompt-agent",
					type: "taskNode",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: {
							executorRef: "agents.logical-task/v2",
							executionMode: "each",
							outputPorts: ["result"],
						},
						workflowResolvedReplayCheckpoint: {
							version: 1,
							kind: "replay_checkpoint",
							sourceExecutionId: "source-execution",
							sourceNodeRunId: "source-run",
							outputRefs: checkpointOutput,
						},
					},
				}],
				edges: [],
			}),
		});
		const runtime = env();
		const response = await new ExecutionDO(state(), runtime).fetch(new Request("https://do/start", { method: "POST" }));

		expect(response.status).toBe(200);
		expect(mocks.updateNodeRun).toHaveBeenNthCalledWith(1, expect.anything(), {
			executionId: "execution-1",
			nodeId: "prompt-agent",
			status: "pending",
			outputRefs: checkpointOutput,
		});
		expect(mocks.updateNodeRun).toHaveBeenNthCalledWith(2, expect.anything(), {
			executionId: "execution-1",
			nodeId: "prompt-agent",
			status: "queued",
		});
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_output_reused",
			nodeId: "prompt-agent",
			data: expect.objectContaining({ kind: "replay_checkpoint", reusedItemCount: 1 }),
		}));
		expect(runtime.WORKFLOW_NODE_QUEUE?.send).toHaveBeenCalledWith({
			executionId: "execution-1",
			nodeId: "prompt-agent",
			nodeRunId: "node-run-1",
			attempt: 1,
		});
	});

	it.each(["owning_chat_turn", "owner_eval"] as const)(
		"cancels one exact user-owned execution for %s, clears scheduling and preserves completed nodes",
		async (actorType) => {
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "running",
			concurrency: 2,
		});
		const executionState = state({
			status: "running",
			concurrency: 2,
			running: 1,
			ready: ["queued-output"],
			indeg: { "completed-input": 0, "running-agent": 0, "queued-output": 1 },
			adj: { "completed-input": ["running-agent"], "running-agent": ["queued-output"], "queued-output": [] },
		});
		const response = await new ExecutionDO(executionState, env()).fetch(new Request("https://do/cancel", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				reasonCode: "user_requested",
				actorType,
				actorId: "public-chat-turn-1",
			}),
		}));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			canceled: true,
			status: "canceled",
			activeNodeIds: ["running-agent", "queued-output"],
		});
		expect(mocks.updateNodeRunsLedger).toHaveBeenCalledWith(expect.anything(), {
			executionId: "execution-1",
			nodeIds: ["running-agent", "queued-output"],
			update: expect.objectContaining({ status: "canceled" }),
		});
		expect(mocks.updateExecutionStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			executionId: "execution-1",
			status: "canceled",
		}));
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "execution_canceled",
			message: "Workflow execution canceled by user",
			data: {
				activeNodeIds: ["running-agent", "queued-output"],
				reasonCode: "user_requested",
				actorType,
				actorId: "public-chat-turn-1",
			},
		}));
		},
	);

	it("terminalizes running and externally waiting siblings when one node fails", async () => {
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "running",
			concurrency: 4,
		});
		mocks.findVersion.mockResolvedValue({
			data: JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
				nodes: ["failed-writer", "pending-output", "running-sibling", "waiting-media"].map((id) => ({
					id,
					type: "taskNode",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: { executorRef: "agents.logical-task/v2" },
					},
				})),
				edges: [],
			})),
		});
		const unsettledFindMany = vi.fn(async () => [
			{ node_id: "pending-output", status: "pending" },
			{ node_id: "running-sibling", status: "running" },
			{ node_id: "waiting-media", status: "waiting_external" },
		]);
		const baseEnv = env();
		const runtime = {
			...baseEnv,
			DB: {
				...baseEnv.DB,
				workflow_node_runs: {
					...baseEnv.DB.workflow_node_runs,
					findMany: unsettledFindMany,
				},
			},
		} as unknown as WorkerEnv;
		const executionState = state({
			status: "running",
			concurrency: 4,
			running: 3,
			ready: ["pending-output"],
			indeg: { "failed-writer": 0, "pending-output": 1, "running-sibling": 0, "waiting-media": 0 },
			adj: { "failed-writer": ["pending-output"], "pending-output": [], "running-sibling": [], "waiting-media": [] },
		});
		const response = await new ExecutionDO(executionState, runtime).fetch(new Request("https://do/nodeComplete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				nodeId: "failed-writer",
				nodeRunId: "node-run-1",
				attempt: 1,
				ok: false,
				errorCode: "writer_failed",
				errorMessage: "writer failed",
			}),
		}));

		expect(response.status).toBe(200);
		expect(mocks.updateNodeRunsLedger).toHaveBeenNthCalledWith(1, expect.anything(), {
			executionId: "execution-1",
			nodeIds: ["pending-output"],
			update: expect.objectContaining({ status: "skipped" }),
		});
		expect(mocks.updateNodeRunsLedger).toHaveBeenNthCalledWith(2, expect.anything(), {
			executionId: "execution-1",
			nodeIds: ["running-sibling", "waiting-media"],
			update: expect.objectContaining({
				status: "canceled",
				errorCode: "workflow_execution_terminalized",
			}),
		});
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "execution_failed",
			data: expect.objectContaining({ terminalizedActiveNodeCount: 2 }),
		}));
	});

	it("serializes event appends across concurrent callbacks without allocating database sequences locally", async () => {
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 1,
			ready: [],
			indeg: { "running-agent": 0 },
			adj: { "running-agent": [] },
		});
		const durableObject = new ExecutionDO(executionState, env());
		const outputRefs = {
			protocolVersion: "1",
			executorRef: "agents.logical-task/v2",
			nodeId: "running-agent",
			executionMode: "each",
			ports: {},
			artifacts: [],
			evidence: { executorCompleted: false },
			itemRuns: [],
		};

		const progressRequest = () => new Request("https://do/nodeProgress", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId: "running-agent", nodeRunId: "node-run-1", attempt: 1, outputRefs }),
		});
		const [firstProgressResponse, secondProgressResponse] = await Promise.all([
			durableObject.fetch(progressRequest()),
			durableObject.fetch(new Request("https://do/nodeProgress", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nodeId: "running-agent", nodeRunId: "node-run-1", attempt: 1, outputRefs }),
			})),
		]);

		expect(firstProgressResponse.status).toBe(202);
		expect(secondProgressResponse.status).toBe(202);
		expect(mocks.insertExecutionEvent).toHaveBeenCalledTimes(2);
		for (const call of mocks.insertExecutionEvent.mock.calls) {
			expect(call[1]).not.toHaveProperty("seq");
			expect(call[1]).toEqual(expect.objectContaining({
				executionId: "execution-1",
				eventType: "node_progress",
				nodeId: "running-agent",
			}));
		}
	});

	it("preserves but never applies output from an obsolete node attempt", async () => {
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 2, status: "running" });
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 1,
			ready: [],
			indeg: { "video-node": 0 },
			adj: { "video-node": [] },
		});
		const lateOutputRefs = { ports: { video: { videoUrl: "https://assets.example/late.mp4" } } };
		const response = await new ExecutionDO(executionState, env()).fetch(new Request("https://do/nodeComplete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				nodeId: "video-node",
				nodeRunId: "node-run-1",
				attempt: 1,
				ok: true,
				outputRefs: lateOutputRefs,
			}),
		}));

		expect(response.status).toBe(208);
		expect(mocks.updateNodeRun).not.toHaveBeenCalled();
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_stale_attempt_ignored",
			nodeId: "video-node",
			data: expect.objectContaining({
				reportedAttempt: 1,
				currentAttempt: 2,
				lateOutputRefs,
			}),
		}));
	});

	it("linearizes duplicate terminal deliveries so one node resolves the DAG exactly once", async () => {
		let nodeStatus = "running";
		mocks.findNodeRun.mockImplementation(async () => ({
			id: "node-run-1",
			attempt: 1,
			status: nodeStatus,
		}));
		mocks.updateNodeRun.mockImplementation(async (_db: unknown, params: Readonly<Record<string, unknown>>) => {
			if (params.nodeId === "shared-agent" && typeof params.status === "string") nodeStatus = params.status;
		});
		const executionState = state({
			status: "running",
			concurrency: 2,
			running: 1,
			ready: [],
			indeg: { "shared-agent": 0, downstream: 1 },
			adj: { "shared-agent": ["downstream"], downstream: [] },
			routes: {
				"shared-agent": [{ target: "downstream", sourcePort: null }],
				downstream: [],
			},
			incoming: { "shared-agent": 0, downstream: 1 },
			activeIncoming: { "shared-agent": 0, downstream: 0 },
			selectiveOutputPorts: { "shared-agent": [], downstream: [] },
			notSelected: [],
		});
		const durableObject = new ExecutionDO(executionState, env());
		const completionRequest = () => new Request("https://do/nodeComplete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				nodeId: "shared-agent",
				nodeRunId: "node-run-1",
				attempt: 1,
				ok: true,
				outputRefs: { ports: { result: "ok" } },
			}),
		});

		const [first, duplicate] = await Promise.all([
			durableObject.fetch(completionRequest()),
			durableObject.fetch(completionRequest()),
		]);

		expect(first.status).toBe(200);
		expect(duplicate.status).toBe(200);
		await expect(duplicate.text()).resolves.toBe("already success");
		expect(mocks.updateNodeRun.mock.calls.filter((call) => call[1]?.nodeId === "shared-agent"))
			.toHaveLength(1);
		expect(mocks.insertExecutionEvent.mock.calls.filter((call) => call[1]?.eventType === "node_succeeded"))
			.toHaveLength(1);
	});
});
