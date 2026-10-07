import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableObjectState } from "@cloudflare/workers-types";
import type { WorkerEnv } from "../../types";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";

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
	findNodeRun: vi.fn(async (): Promise<{ id: string; attempt: number; status: string; output_refs?: string | null }> =>
		({ id: "node-run-1", attempt: 1, status: "running", output_refs: null })),
	findNodeAttempt: vi.fn(async () => ({ execution_id: "execution-1", node_id: "media", node_run_id: "node-run-1", attempt: 1 })),
	findFirstNodeRun: vi.fn<[], Promise<{ id: string } | null>>(async () => ({ id: "node-run-1" })),
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
			findFirst: mocks.findFirstNodeRun,
			findUnique: mocks.findNodeRun,
			findMany: mocks.findNodeRuns,
			update: mocks.updateNodeRunDirect,
			updateMany: mocks.updateNodeRunsDirect,
		},
		workflow_execution_events: { findFirst: mocks.findLatestEvent },
		workflow_node_attempts: { findUnique: mocks.findNodeAttempt },
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
import { WorkflowOutputCheckpointStaleError } from "./execution.node-run-store";
import { freezeWorkflowExecutionSemanticsSnapshot } from "./execution.semantics-snapshot";
import { decodeWorkflowOutput, encodeWorkflowOutput, workflowOutputDelta, type StoredWorkflowOutput } from "./execution.output-storage";
import { createWorkflowOutputCheckpointSender, workflowOutputRootHash,
	type WorkflowOutputCheckpointPacket, type WorkflowOutputCheckpointWrite } from "./execution.output-checkpoint-packet";

function initialCheckpoint(output: unknown): WorkflowOutputCheckpointPacket {
	const encoded = encodeWorkflowOutput(output);
	return { version: 1, baseRootHash: null, ...workflowOutputDelta(encoded, []) };
}

function preparedCheckpoint(output: unknown) {
	return { output: encodeWorkflowOutput(output), nodeRunId: "node-run-1", attempt: 1, baseRootHash: null };
}

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
		mocks.findFirstNodeRun.mockResolvedValue({ id: "node-run-1" });
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running", output_refs: null });
		mocks.findNodeRuns.mockResolvedValue([
			{ node_id: "running-agent", status: "running", output_refs: null },
			{ node_id: "queued-output", status: "queued", output_refs: null },
		]);
		mocks.findLatestEvent.mockResolvedValue({ seq: 7, created_at: "2026-08-22T21:10:30.000Z" });
	});

	it("rehydrates a stranded pending frontier and dispatches it without incrementing attempts", async () => {
		mocks.findExecution.mockResolvedValue({ id:"execution-1",flow_version_id:"version-1",status:"running",concurrency:16 });
		mocks.findVersion.mockResolvedValue({data:JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
			nodes:[{id:"next",type:"taskNode",data:{kind:"workflowStage",workflowAtomicSpec:{executorRef:"workflow.input.text/v1"}}}],edges:[],
		}))});
		mocks.findNodeRuns.mockResolvedValue([{node_id:"next",status:"pending",output_refs:null}]);
		mocks.findNodeRun.mockResolvedValue({id:"run-next",attempt:1,status:"pending"});
		const bindings = env();
		const response = await new ExecutionDO(state(),bindings).fetch(new Request("https://do/recoverAfterRestart",{
			method:"POST",body:JSON.stringify({recoveryReason:"local_abandonment",ownershipStaleBefore:"2026-09-22T00:00:00.000Z",recoverableNodeIds:[],unsafeNodeIds:[]}),
		}));
		expect(response.status).toBe(200);
		expect(bindings.WORKFLOW_NODE_QUEUE?.send).toHaveBeenCalled();
		expect(mocks.incrementNodeRunAttempt).not.toHaveBeenCalled();
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

	it("resumes a claimed start whose node initialization rolled back without resetting its start time", async () => {
		mocks.findExecution.mockResolvedValue({ id: "execution-1", flow_version_id: "version-1", status: "running", concurrency: 1 });
		mocks.findFirstNodeRun.mockResolvedValue(null);
		mocks.findVersion.mockResolvedValue({ data: JSON.stringify({ nodes: [], edges: [] }) });
		const response = await new ExecutionDO(state(), env()).fetch(new Request("https://do/start", { method: "POST" }));
		expect(response.status).toBe(200);
		expect(mocks.claim).not.toHaveBeenCalled();
		expect(mocks.findVersion).toHaveBeenCalledTimes(1);
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

	it("rehydrates a missing scheduler graph before a queued worker starts", async () => {
		mocks.findExecution.mockResolvedValue({
			id: "execution-1",
			flow_version_id: "version-1",
			status: "running",
			concurrency: 1,
		});
		mocks.findVersion.mockResolvedValue({
			data: JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
				nodes: [{
					id: "queued-trigger",
					type: "taskNode",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: { executorRef: "workflow.trigger/v1" },
					},
				}],
				edges: [],
			})),
		});
		mocks.findNodeRun.mockResolvedValue({
			id: "node-run-1",
			attempt: 1,
			status: "queued",
		});
		mocks.findNodeRuns.mockResolvedValue([
			{ node_id: "queued-trigger", status: "queued", output_refs: null },
		]);

		const response = await new ExecutionDO(state(), env()).fetch(new Request("https://do/nodeStarted", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				nodeId: "queued-trigger",
				nodeRunId: "node-run-1",
				attempt: 1,
			}),
		}));

		expect(response.status).toBe(202);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), {
			executionId: "execution-1",
			nodeId: "queued-trigger",
			status: "running",
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			startedAt: expect.any(String),
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
			requiredInputPorts: Object.fromEntries(Object.keys({ "prompt-agent": 0 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "prompt-agent": 0 }).map(id => [id, []])),
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
			body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "prompt-agent", nodeRunId: "node-run-1", attempt: 1, outputCheckpoint: initialCheckpoint(outputRefs) }),
		}));

		expect(response.status).toBe(202);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			executionId: "execution-1",
			nodeId: "prompt-agent",
			status: "running",
			outputCheckpoint: preparedCheckpoint(outputRefs),
		}));
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			executionId: "execution-1",
			eventType: "node_progress",
			data: expect.objectContaining({ completedItems: 1, settledItems: 1, totalItems: 19 }),
		}));
	});

	it("persists a single agent repair checkpoint without ending its running attempt", async () => {
		const executionState = state({ status: "running", concurrency: 1, running: 1, ready: [],
			indeg: { "prompt-agent": 0 }, requiredInputPorts: { "prompt-agent": [] },
			activeInputPorts: { "prompt-agent": [] }, adj: { "prompt-agent": [] } });
		const outputRefs = { protocolVersion: "1", executorRef: "agents.logical-task/v2",
			nodeId: "prompt-agent", executionMode: "once", ports: {}, artifacts: [], itemRuns: [],
			evidence: { executorCompleted: false, continuationReason: "structured_output_repair_required",
				outputRepair: { candidate: "original author output" } } };
		const durableObject = new ExecutionDO(executionState, env());
		const response = await durableObject.fetch(new Request("https://do/nodeProgress", {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "prompt-agent", nodeRunId: "node-run-1", attempt: 1, outputCheckpoint: initialCheckpoint(outputRefs) }),
		}));
		expect(response.status).toBe(202);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			nodeId: "prompt-agent", status: "running", outputCheckpoint: preparedCheckpoint(outputRefs),
		}));
		const mismatch = await durableObject.fetch(new Request("https://do/nodeProgress", {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "another-node", nodeRunId: "node-run-1", attempt: 1, outputCheckpoint: initialCheckpoint(outputRefs) }),
		}));
		expect(mismatch.status).toBe(409);
		expect(mocks.updateNodeRun).toHaveBeenCalledTimes(1);
	});

	it("rejects semantic checkpoint requests and stale packet attempts without writing output", async () => {
		const durableObject = new ExecutionDO(state({ status: "running", concurrency: 1, running: 1, ready: [],
			indeg: { "prompt-agent": 0 }, requiredInputPorts: { "prompt-agent": [] },
			activeInputPorts: { "prompt-agent": [] }, adj: { "prompt-agent": [] } }), env());
		const outputRefs = { protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: "prompt-agent",
			executionMode: "once", ports: {}, artifacts: [], itemRuns: [], evidence: { taskId: "accepted" } };
		const legacy = await durableObject.fetch(new Request("https://do/nodeProgress", {
			method: "POST", body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "prompt-agent",
				nodeRunId: "node-run-1", attempt: 1, outputRefs }),
		}));
		expect(legacy.status).toBe(400);
		const stale = await durableObject.fetch(new Request("https://do/nodeProgress", {
			method: "POST", body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "prompt-agent",
				nodeRunId: "node-run-1", attempt: 2, outputCheckpoint: initialCheckpoint(outputRefs) }),
		}));
		expect(stale.status).toBe(208);
		expect(mocks.updateNodeRun).not.toHaveBeenCalled();
	});

	it("applies each next packet to the current stored base and rejects an old base with 409", async () => {
		const durableObject = new ExecutionDO(state({ status: "running", concurrency: 1, running: 1, ready: [],
			indeg: { "prompt-agent": 0 }, requiredInputPorts: { "prompt-agent": [] },
			activeInputPorts: { "prompt-agent": [] }, adj: { "prompt-agent": [] } }), env());
		let persisted: StoredWorkflowOutput | null = null;
		mocks.findNodeRun.mockImplementation(async () => ({ id: "node-run-1", attempt: 1, status: "running",
			output_refs: persisted === null ? null : JSON.stringify(persisted) }));
		const persist = async (_db: unknown, params: Readonly<Record<string, unknown>>) => {
			persisted = (params.outputCheckpoint as WorkflowOutputCheckpointWrite).output;
			return undefined;
		};
		mocks.updateNodeRun.mockImplementationOnce(persist).mockImplementationOnce(persist);
		const packets: WorkflowOutputCheckpointPacket[] = [];
		const request = (packet: unknown) => new Request("https://do/nodeProgress", { method: "POST",
			body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "prompt-agent", nodeRunId: "node-run-1", attempt: 1,
				outputCheckpoint: packet }) });
		const send = createWorkflowOutputCheckpointSender(async packet => {
			packets.push(packet);
			const response = await durableObject.fetch(request(packet));
			if (response.status !== 202) throw new Error(await response.text());
		});
		const output = { protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: "prompt-agent",
			executionMode: "once", ports: {}, artifacts: [], itemRuns: [],
			evidence: { taskId: "accepted", body: "retained author output".repeat(1_000), completedItems: 0 } };
		await send(output);
		const base = workflowOutputRootHash(persisted!);
		output.evidence.completedItems = 1;
		await send(output);
		expect(packets[1]!.baseRootHash).toBe(base);
		expect(mocks.updateNodeRun).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
			outputCheckpoint: { output: persisted, nodeRunId: "node-run-1", attempt: 1, baseRootHash: base },
		}));
		expect(decodeWorkflowOutput(persisted)).toEqual(output);
		const current = JSON.stringify(persisted);
		const stale = await durableObject.fetch(request(packets[1]));
		expect(stale.status).toBe(409);
		await expect(stale.text()).resolves.toBe("workflow_output_checkpoint_stale_base");
		const malformed = await durableObject.fetch(request({ ...packets[1], root: ["invalid", []] }));
		expect(malformed.status).toBe(400);
		expect(JSON.stringify(persisted)).toBe(current);
		expect(mocks.updateNodeRun).toHaveBeenCalledTimes(2);
	});

	it("keeps an unknown committed checkpoint and stops its sender before another request", async () => {
		const durableObject = new ExecutionDO(state({ status: "running", concurrency: 1, running: 1, ready: [],
			indeg: { "prompt-agent": 0 }, requiredInputPorts: { "prompt-agent": [] },
			activeInputPorts: { "prompt-agent": [] }, adj: { "prompt-agent": [] } }), env());
		let persisted: StoredWorkflowOutput | null = null;
		mocks.findNodeRun.mockImplementation(async () => ({ id: "node-run-1", attempt: 1, status: "running",
			output_refs: persisted === null ? null : JSON.stringify(persisted) }));
		const persist = async (_db: unknown, params: Readonly<Record<string, unknown>>) => {
			persisted = (params.outputCheckpoint as WorkflowOutputCheckpointWrite).output;
			return undefined;
		};
		mocks.updateNodeRun.mockImplementationOnce(persist).mockImplementationOnce(persist);
		const failure = new Error("checkpoint committed; acknowledgement unavailable");
		mocks.insertExecutionEvent.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
		const packets: WorkflowOutputCheckpointPacket[] = [];
		const send = createWorkflowOutputCheckpointSender(async packet => {
			packets.push(packet);
			const response = await durableObject.fetch(new Request("https://do/nodeProgress", { method: "POST",
				body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "prompt-agent", nodeRunId: "node-run-1", attempt: 1,
					outputCheckpoint: packet }) }));
			if (response.status !== 202) throw new Error(await response.text());
		});
		const output = { protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: "prompt-agent",
			executionMode: "once", ports: {}, artifacts: [], itemRuns: [], evidence: { taskId: "accepted", completedItems: 0 } };
		await send(output);
		const base = workflowOutputRootHash(persisted!);
		output.evidence.completedItems = 1;
		await expect(send(output)).rejects.toMatchObject({ name: "WorkflowOutputCheckpointWriterError", cause: failure });
		output.evidence.taskId = "must-not-be-submitted";
		await expect(send(output)).rejects.toBe(send.failure());
		expect(packets).toHaveLength(2);
		expect(packets[1]!.baseRootHash).toBe(base);
		expect(JSON.stringify(packets)).not.toContain("must-not-be-submitted");
		expect(decodeWorkflowOutput(persisted)).toMatchObject({ evidence: { taskId: "accepted", completedItems: 1 } });
		expect(mocks.updateNodeRun).toHaveBeenCalledTimes(2);
	});

	it.each(["running", "waiting_external"])("keeps dependent work behind %s collection checkpoints until successful completion", async (status) => {
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status, output_refs: null });
		const executionState = state({
			status: "running", concurrency: 2, running: status === "running" ? 1 : 0, ready: [],
			indeg: { producer: 0, consumer: 1 }, adj: { producer: ["consumer"], consumer: [] },
			routes: { producer: [{ target: "consumer", sourcePort: "items", targetPort: "items" }], consumer: [] },
			incoming: { producer: 0, consumer: 1 }, activeIncoming: { producer: 0, consumer: 0 },
			activeInputPorts: { producer: [], consumer: [] }, requiredInputPorts: { producer: [], consumer: ["items"] },
			selectiveOutputPorts: { producer: [], consumer: [] }, notSelected: [],
		});
		const runtime = env();
		const durableObject = new ExecutionDO(executionState, runtime);
		const output = (count: number, completed: boolean) => ({
			protocolVersion: "1", executorRef: "workflow.pipeline.run/v1", nodeId: "producer", executionMode: "once",
			ports: { items: createWorkflowCollection({
				collectionId: "prepared-items", producerNodeId: "producer", producerPortId: "items",
				itemIds: ["item-a", "item-b"].slice(0, count),
				values: [{ nodeId: "node-a", prompt: "first prompt" }, { nodeId: "node-b", prompt: "second prompt" }].slice(0, count),
			}) },
			artifacts: [], itemRuns: [],
			evidence: { executorCompleted: completed, completedItems: count, totalItems: 2 },
		});
		// Neither a partial collection nor all visible items acknowledge the producer's persistence boundary.
		for (const count of [1, 2]) {
			const checkpoint = output(count, false);
			const response = await durableObject.fetch(new Request("https://do/nodeProgress", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "producer", nodeRunId: "node-run-1", attempt: 1, outputCheckpoint: initialCheckpoint(checkpoint) }),
			}));
			expect(response.status).toBe(202);
			expect(mocks.updateNodeRun).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
				nodeId: "producer", status, outputCheckpoint: preparedCheckpoint(checkpoint),
			}));
			await expect(executionState.storage.get("graph")).resolves.toMatchObject({
				indeg: { consumer: 1 }, activeInputPorts: { consumer: [] }, ready: [],
			});
			expect(runtime.WORKFLOW_NODE_QUEUE?.send).not.toHaveBeenCalled();
		}
		const completed = output(2, true);
		const completedStored = encodeWorkflowOutput(completed);
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running", output_refs: JSON.stringify(completedStored) });
		const response = await durableObject.fetch(new Request("https://do/nodeComplete", {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId: "producer", nodeRunId: "node-run-1", attempt: 1, ok: true, expectedOutputRootHash: workflowOutputRootHash(completedStored) }),
		}));
		expect(response.status).toBe(200);
		await expect(executionState.storage.get("graph")).resolves.toMatchObject({
			indeg: { consumer: 0 }, activeInputPorts: { consumer: ["items"] },
		});
		expect(runtime.WORKFLOW_NODE_QUEUE?.send).toHaveBeenCalledTimes(1);
		expect(runtime.WORKFLOW_NODE_QUEUE?.send).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "consumer" }));
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
			requiredInputPorts: Object.fromEntries(Object.keys({ "recovering-agent": 0 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "recovering-agent": 0 }).map(id => [id, []])),
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
			requiredInputPorts: Object.fromEntries(Object.keys({ "queued-agent": 0 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "queued-agent": 0 }).map(id => [id, []])),
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
			requiredInputPorts: Object.fromEntries(Object.keys({ "long-agent": 0 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "long-agent": 0 }).map(id => [id, []])),
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
			requiredInputPorts: Object.fromEntries(Object.keys({ "long-agent": 0 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "long-agent": 0 }).map(id => [id, []])),
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

	it("rejects a stage time target as cancellation authority without changing running work", async () => {
		const executionState = state({ status: "running", running: 1, ready: ["next"] });
		const response = new ExecutionDO(executionState, env()).fetch(new Request("https://do/cancel", {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ reasonCode: "video_production_start_deadline_exceeded", actorType: "deadline_enforcer", actorId: "turn-1" }),
		}));
		await expect(response).rejects.toThrow("reasonCode must be user_requested");
		expect(mocks.updateExecutionStatus).not.toHaveBeenCalled();
		expect(mocks.updateNodeRunsLedger).not.toHaveBeenCalled();
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
			requiredInputPorts: Object.fromEntries(Object.keys({ "completed-input": 0, "running-agent": 0, "queued-output": 1 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "completed-input": 0, "running-agent": 0, "queued-output": 1 }).map(id => [id, []])),
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

	it.each([false, true])("isolates a local failure and only settles when independent work is finished: %s", async (siblingsSettled) => {
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
		if (siblingsSettled) {
			unsettledFindMany.mockResolvedValueOnce([{ node_id: "pending-output", status: "pending" }]);
			unsettledFindMany.mockResolvedValue([
				{ node_id: "failed-writer", status: "failed" },
				{ node_id: "pending-output", status: "skipped" },
				{ node_id: "running-sibling", status: "success" },
				{ node_id: "waiting-media", status: "success" },
			]);
		}
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
			requiredInputPorts: Object.fromEntries(Object.keys({ "failed-writer": 0, "pending-output": 1, "running-sibling": 0, "waiting-media": 0 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "failed-writer": 0, "pending-output": 1, "running-sibling": 0, "waiting-media": 0 }).map(id => [id, []])),
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
				expectedOutputRootHash: null,
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
		expect(mocks.updateNodeRunsLedger).toHaveBeenCalledTimes(1);
		if (siblingsSettled) {
			expect(mocks.updateExecutionStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "failed" }));
		} else {
			expect(mocks.updateExecutionStatus).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "failed" }));
		}
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			eventType: "node_failure_isolated",
			data: expect.objectContaining({ blockedNodeCount: 1 }),
		}));
	});

	it("serializes event appends across concurrent callbacks without allocating database sequences locally", async () => {
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 1,
			ready: [],
			indeg: { "running-agent": 0 },
			requiredInputPorts: Object.fromEntries(Object.keys({ "running-agent": 0 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "running-agent": 0 }).map(id => [id, []])),
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
			body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "running-agent", nodeRunId: "node-run-1", attempt: 1, outputCheckpoint: initialCheckpoint(outputRefs) }),
		});
		const [firstProgressResponse, secondProgressResponse] = await Promise.all([
			durableObject.fetch(progressRequest()),
			durableObject.fetch(new Request("https://do/nodeProgress", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ progressKind: "output_checkpoint", nodeId: "running-agent", nodeRunId: "node-run-1", attempt: 1, outputCheckpoint: initialCheckpoint(outputRefs) }),
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

	it("ignores obsolete lifecycle attempts without applying their output root", async () => {
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 2, status: "running" });
		const executionState = state({
			status: "running",
			concurrency: 1,
			running: 1,
			ready: [],
			indeg: { "video-node": 0 },
			requiredInputPorts: Object.fromEntries(Object.keys({ "video-node": 0 }).map(id => [id, []])),
			activeInputPorts: Object.fromEntries(Object.keys({ "video-node": 0 }).map(id => [id, []])),
			adj: { "video-node": [] },
		});
		const response = await new ExecutionDO(executionState, env()).fetch(new Request("https://do/nodeComplete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				nodeId: "video-node",
				nodeRunId: "node-run-1",
				attempt: 1,
				ok: true,
				expectedOutputRootHash: "a".repeat(64),
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
			}),
		}));
	});

	it("linearizes duplicate terminal deliveries so one node resolves the DAG exactly once", async () => {
		let nodeStatus = "running";
		const stored = encodeWorkflowOutput({ protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: "shared-agent",
			executionMode: "once", ports: { result: "ok" }, evidence: {}, artifacts: [], itemRuns: [] });
		mocks.findNodeRun.mockImplementation(async () => ({
			id: "node-run-1",
			attempt: 1,
			status: nodeStatus,
			output_refs: JSON.stringify(stored),
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
			activeInputPorts: { "shared-agent": [], downstream: [] },
			requiredInputPorts: { "shared-agent": [], downstream: [] },
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
				expectedOutputRootHash: workflowOutputRootHash(stored),
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

describe("acknowledged lifecycle output and retained checkpoint observations", () => {
	function graph(status = "running") {
		return { status, concurrency: 1, running: 1, ready: [], indeg: { media: 0 }, adj: { media: [] },
			routes: { media: [] }, incoming: { media: 0 }, activeIncoming: { media: 0 },
			activeInputPorts: { media: [] }, requiredInputPorts: { media: [] }, selectiveOutputPorts: { media: [] }, notSelected: [] };
	}
	function output(evidence: Readonly<Record<string, unknown>> = {}) {
		return { protocolVersion: "1", executorRef: "tapcanvas.video.generate/v1", nodeId: "media", executionMode: "once",
			ports: {}, artifacts: [], itemRuns: [], evidence: { taskId: "accepted-current", ...evidence },
			externalCheck: { version: 1, mode: "poll", notBeforeAt: "2026-10-01T00:00:00.000Z" } };
	}
	function request(path: string, fields: Readonly<Record<string, unknown>>) {
		return new Request(`https://do/${path}`, { method: "POST", body: JSON.stringify({ nodeId: "media", nodeRunId: "node-run-1", attempt: 1,
			...(path === "nodeCheckpointObservation" ? { baseRootHash: null } : {}), ...fields }) });
	}
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockClear();
		mocks.updateNodeRun.mockReset().mockResolvedValue(undefined);
		mocks.insertExecutionEvent.mockReset().mockResolvedValue(undefined);
		mocks.incrementNodeRunAttempt.mockReset().mockResolvedValue(2);
		mocks.updateNodeRunsLedger.mockReset().mockResolvedValue(undefined);
		mocks.findNodeRun.mockReset().mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running", output_refs: null });
		mocks.findNodeAttempt.mockReset().mockResolvedValue({ execution_id: "execution-1", node_id: "media", node_run_id: "node-run-1", attempt: 1 });
		mocks.findExecution.mockResolvedValue({ id: "execution-1", flow_version_id: "version-1", status: "running", concurrency: 1 });
		mocks.findVersion.mockResolvedValue({ data: JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [{ id: "media", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" } } }], edges: [],
		})) });
	});
	it.each(["nodeWaiting", "nodeComplete"])("rejects semantic output bypass and changed acknowledged roots for %s", async (path) => {
		const stored = encodeWorkflowOutput(output());
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running", output_refs: JSON.stringify(stored) });
		const executionState = state(graph());
		const durableObject = new ExecutionDO(executionState, env());
		const bypass = await durableObject.fetch(request(path, { ok: true, outputRefs: output(), expectedOutputRootHash: workflowOutputRootHash(stored) }));
		expect(bypass.status).toBe(400);
		const stale = await durableObject.fetch(request(path, { ok: true, expectedOutputRootHash: "a".repeat(64) }));
		expect(stale.status).toBe(409);
		const initialize = await durableObject.fetch(request(path, { ok: true, expectedOutputRootHash: null }));
		expect(initialize.status).toBe(409);
		expect(mocks.updateNodeRun).not.toHaveBeenCalled();
		expect(executionState.storage.put).not.toHaveBeenCalled();
		expect(mocks.insertExecutionEvent).not.toHaveBeenCalled();
	});
	it("reads the external wait schedule from acknowledged storage and mirrors it with CAS", async () => {
		const semantic = output();
		const stored = encodeWorkflowOutput(semantic);
		const expectedOutputRootHash = workflowOutputRootHash(stored);
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running", output_refs: JSON.stringify(stored) });
		const executionState = state(graph());
		const response = await new ExecutionDO(executionState, env()).fetch(request("nodeWaiting", { expectedOutputRootHash }));
		expect(response.status).toBe(202);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "waiting_external",
			outputCheckpoint: { output: stored, nodeRunId: "node-run-1", attempt: 1, baseRootHash: expectedOutputRootHash } }));
		expect(mocks.updateNodeRun.mock.calls[0]![1]).not.toHaveProperty("outputRefs");
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "node_waiting_external",
			data: expect.objectContaining({ externalWait: expect.objectContaining({ scheduleStatus: "recorded", schedule: semantic.externalCheck }) }) }));
		await expect(executionState.storage.get("graph")).resolves.toMatchObject({ running: 0 });
	});
	it.each([true, false])("retains materialized media and its acknowledged receipt after terminal completion: %s", async (ok) => {
		const assetUrl = "https://media.test/retained.mp4";
		const produced = { ...output(), ports: { video: { videoUrl: assetUrl } },
			artifacts: [{ type: "video", identity: "retained-asset", value: { url: assetUrl } }] };
		const stored = encodeWorkflowOutput(produced);
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running", output_refs: JSON.stringify(stored) });
		const executionState = state(graph(ok ? "running" : "failed"));
		mocks.findExecution.mockClear();
		const response = await new ExecutionDO(executionState, env()).fetch(request("nodeComplete", {
			ok, expectedOutputRootHash: workflowOutputRootHash(stored),
			...(!ok ? { errorCode: "later_probe_failed", errorMessage: "Post-generation probe failed" } : {}),
		}));
		expect(response.status).toBe(200);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			outputCheckpoint: expect.objectContaining({ output: ok ? stored : null,
				baseRootHash: workflowOutputRootHash(stored) }),
		}));
		// Terminal settlement no longer opens a second flow mutation/cleanup path.
		expect(mocks.findExecution).not.toHaveBeenCalled();
		expect(mocks.insertExecutionEvent.mock.calls.some(([, event]) => event.eventType === "execution_fanout_nodes_stripped")).toBe(false);
		expect(decodeWorkflowOutput(stored)).toMatchObject({ artifacts: [{ value: { url: assetUrl } }], evidence: { taskId: "accepted-current" } });
	});
	it.each(["running", "failed", "canceled"])("uses the acknowledged root for successful delivery while graph is %s", async (graphStatus) => {
		const stored = encodeWorkflowOutput(output());
		const expectedOutputRootHash = workflowOutputRootHash(stored);
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: graphStatus === "canceled" ? "canceled" : "running", output_refs: JSON.stringify(stored) });
		const response = await new ExecutionDO(state(graph(graphStatus)), env()).fetch(request("nodeComplete", { ok: true, expectedOutputRootHash }));
		expect(response.status).toBe(200);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: graphStatus === "canceled" ? "canceled" : "success",
			outputCheckpoint: { output: stored, nodeRunId: "node-run-1", attempt: 1, baseRootHash: expectedOutputRootHash } }));
		expect(mocks.updateNodeRun.mock.calls[0]![1]).not.toHaveProperty("outputRefs");
	});
	it.each(["nodeWaiting", "nodeComplete"])("keeps graph ownership when transaction CAS rejects %s", async (path) => {
		const stored = encodeWorkflowOutput(output());
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running", output_refs: JSON.stringify(stored) });
		mocks.updateNodeRun.mockRejectedValueOnce(new WorkflowOutputCheckpointStaleError("base_root_changed"));
		const executionState = state(graph());
		const response = await new ExecutionDO(executionState, env()).fetch(request(path, { ok: true, expectedOutputRootHash: workflowOutputRootHash(stored) }));
		expect(response.status).toBe(409);
		await expect(executionState.storage.get("graph")).resolves.toMatchObject({ running: 1 });
		expect(executionState.storage.put).not.toHaveBeenCalled();
		expect(mocks.insertExecutionEvent).not.toHaveBeenCalled();
	});
	it.each(["running", "failed"])("uses guard-only CAS for a runtime failure with no new result while graph is %s", async (graphStatus) => {
		const executionState = state(graph(graphStatus));
		const response = await new ExecutionDO(executionState, env()).fetch(request("nodeComplete", { ok: false, expectedOutputRootHash: null, errorMessage: "runtime action failed" }));
		expect(response.status).toBe(graphStatus === "running" ? 202 : 200);
		expect(mocks.updateNodeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: graphStatus === "running" ? "running" : "failed",
			outputCheckpoint: { output: null, nodeRunId: "node-run-1", attempt: 1, baseRootHash: null } }));
		expect(mocks.updateNodeRun.mock.calls[0]![1]).not.toHaveProperty("outputRefs");
	});
	it("guards the acknowledged failure evidence before advancing a retry attempt", async () => {
		const stored = encodeWorkflowOutput(output({ retryableByDurableWorkflow: true, retryableFailure: "observation_unavailable", workflowRetryCount: 3 }));
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 1, status: "running", output_refs: JSON.stringify(stored) });
		const runtime = env();
		const response = await new ExecutionDO(state(graph()), runtime).fetch(request("nodeComplete", { ok: false, expectedOutputRootHash: workflowOutputRootHash(stored), errorMessage: "observation failed" }));
		expect(response.status).toBe(202);
		expect(mocks.updateNodeRun.mock.calls[0]![1]).toMatchObject({ outputCheckpoint: { output: null, baseRootHash: workflowOutputRootHash(stored), nodeRunId: "node-run-1", attempt: 1 } });
		expect(mocks.updateNodeRun.mock.invocationCallOrder[0]).toBeLessThan(mocks.incrementNodeRunAttempt.mock.invocationCallOrder[0]!);
		expect(mocks.incrementNodeRunAttempt).toHaveBeenCalledTimes(1);
	});
	it("retains unknown-ack sibling snapshots for a historical attempt without changing the current output", async () => {
		const executionState = state(graph("failed"));
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 2, status: "waiting_external", output_refs: JSON.stringify(encodeWorkflowOutput(output())) });
		const snapshots = [output({ taskId: "accepted-unacknowledged-a", body: "retained".repeat(200_000) }), output({ taskId: "accepted-unacknowledged-b" })];
		const runtime = env();
		const response = await new ExecutionDO(executionState, runtime).fetch(request("nodeCheckpointObservation", { snapshots, baseRootHash: "b".repeat(64), failureReason: "commit acknowledgement unavailable" }));
		expect(response.status).toBe(202);
		expect(mocks.findNodeAttempt).toHaveBeenCalledWith({ where: { node_run_id_attempt: { node_run_id: "node-run-1", attempt: 1 } }, select: { execution_id: true, node_id: true, node_run_id: true, attempt: true } });
		expect(mocks.insertExecutionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "node_checkpoint_observation", data: { nodeRunId: "node-run-1", attempt: 1, snapshots, baseRootHash: "b".repeat(64), failureReason: "commit acknowledgement unavailable", terminalAuthority: false } }));
		expect(mocks.findNodeRun).not.toHaveBeenCalled();
		expect(mocks.updateNodeRun).not.toHaveBeenCalled();
		expect(mocks.updateExecutionStatus).not.toHaveBeenCalled();
		expect(executionState.storage.put).not.toHaveBeenCalled();
		expect(runtime.WORKFLOW_NODE_QUEUE?.send).not.toHaveBeenCalled();
	});
	it("logs only checkpoint identity, hashes and counts when a physical attempt is stale", async () => {
		mocks.findNodeRun.mockResolvedValue({ id: "node-run-1", attempt: 2, status: "running", output_refs: null });
		const log = vi.spyOn(console, "info").mockImplementation(() => {});
		try {
			const response = await new ExecutionDO(state(graph()), env()).fetch(request("nodeProgress", {
				progressKind: "output_checkpoint", outputCheckpoint: initialCheckpoint(output({ privateText: "private-source-marker".repeat(1_000) })),
			}));
			expect(response.status).toBe(208);
			const diagnostics = log.mock.calls.map(call => JSON.parse(call[0] as string) as Record<string, unknown>);
			expect(diagnostics).toContainEqual(expect.objectContaining({ message: "node_progress_rejected_attempt", reportedNodeRunId: "node-run-1", reportedAttempt: 1,
				baseRootHash: null, blockCount: expect.any(Number) }));
			expect(JSON.stringify(diagnostics)).not.toContain("private-source-marker");
			expect(JSON.stringify(diagnostics)).not.toContain("attemptBody");
			expect(JSON.stringify(mocks.insertExecutionEvent.mock.calls)).not.toContain("private-source-marker");
		} finally { log.mockRestore(); }
	});
	it.each([{ execution_id: "another-execution" }, { node_id: "another-node" }, { node_run_id: "another-run" }, { attempt: 2 }])("rejects an observation whose historical attempt ownership is invalid %j", async (wrong) => {
		mocks.findNodeAttempt.mockResolvedValue({ execution_id: "execution-1", node_id: "media", node_run_id: "node-run-1", attempt: 1, ...wrong });
		const response = await new ExecutionDO(state(graph()), env()).fetch(request("nodeCheckpointObservation", { snapshots: [output()], failureReason: "unknown acknowledgement" }));
		expect(response.status).toBe(404);
		expect(mocks.insertExecutionEvent).not.toHaveBeenCalled();
		expect(mocks.updateNodeRun).not.toHaveBeenCalled();
	});
	it.each([{ snapshots: [{}], failureReason: "invalid" }, { snapshots: [{ ...output(), nodeId: "wrong" }], failureReason: "invalid" },
		{ snapshots: [output()], failureReason: "" }, { snapshots: [output()], failureReason: "invalid", baseRootHash: "invalid" },
		{ snapshots: [output()], failureReason: "invalid", baseRootHash: undefined }])("rejects malformed observation snapshots before reading history %j", async (fields) => {
		const response = await new ExecutionDO(state(graph()), env()).fetch(request("nodeCheckpointObservation", fields));
		expect(response.status).toBe(400);
		expect(mocks.findNodeAttempt).not.toHaveBeenCalled();
		expect(mocks.insertExecutionEvent).not.toHaveBeenCalled();
	});
});

describe("terminal projection release", () => {
  it("requires a persisted terminal status before releasing even an empty projection", async () => {
    const instance = new ExecutionDO(state(), env());
    mocks.findExecution.mockResolvedValue({ id: "execution-1", flow_version_id: "version-1", status: "running", concurrency: 1 });
    expect(await instance.canRelease()).toBe(false);
    mocks.findExecution.mockResolvedValue({ id: "execution-1", flow_version_id: "version-1", status: "success", concurrency: 1 });
    mocks.findFirstNodeRun.mockResolvedValue(null);
    expect(await instance.canRelease()).toBe(true);
  });

  it("keeps running graph state without querying the database", async () => {
    const instance = new ExecutionDO(state({ status: "running", requiredInputPorts: {}, activeInputPorts: {} }), env());
    mocks.findExecution.mockClear();
    expect(await instance.canRelease()).toBe(false);
    expect(mocks.findExecution).not.toHaveBeenCalled();
  });
});

 it("retains a failed execution projection while accepted sibling work remains", async () => {
   const instance = new ExecutionDO(state(), env());
   mocks.findExecution.mockResolvedValue({ id: "execution-1", flow_version_id: "version-1", status: "failed", concurrency: 1 });
   mocks.findFirstNodeRun.mockResolvedValue({ id: "accepted-sibling" });
   expect(await instance.canRelease()).toBe(false);
 });
