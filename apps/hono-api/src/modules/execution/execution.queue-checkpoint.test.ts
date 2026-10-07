import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";
import type { WorkflowNodeExecutorDependencies, WorkflowNodeExecutionContext } from "./execution.node-executors";
import type { WorkflowNodeExecutionResult, WorkflowNodeOutputV1 } from "./execution.node-runtime";
import {
	applyWorkflowOutputCheckpointPacket, parseWorkflowOutputCheckpointPacket, workflowOutputRootHash,
	type WorkflowOutputCheckpointWrite,
} from "./execution.output-checkpoint-packet";
import { encodeWorkflowOutput, type StoredWorkflowOutput } from "./execution.output-storage";

const mocks = vi.hoisted(() => ({ execute: vi.fn(),
	updateNodeRun: vi.fn(async (_db: unknown, _params: Readonly<{ outputCheckpoint?: WorkflowOutputCheckpointWrite }>): Promise<void> => undefined),
	insertEvent: vi.fn(async () => 1) }));
vi.mock("./execution.node-executors", async importOriginal => ({
	...await importOriginal<typeof import("./execution.node-executors")>(),
	executeRegisteredWorkflowNode: mocks.execute,
}));
vi.mock("./execution.repo", () => ({ updateNodeRun: mocks.updateNodeRun, insertExecutionEvent: mocks.insertEvent }));
import { handleWorkflowNodeJob } from "./execution.queue";

function receipt(): WorkflowNodeOutputV1 {
	return { protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: "node-1",
		executionMode: "once", ports: {}, artifacts: [], itemRuns: [],
		evidence: { taskId: "already-accepted", authorBody: "retained synthetic author material ".repeat(10_000) } };
}

function fixture(initial: StoredWorkflowOutput | null = null, failure: "stale" | "ack_unknown" | null = null,
	observationFails = false, recovery?: Readonly<{
		events: readonly Readonly<{ id: string; seq: number; event_type: string; data: string }>[];
		attempt?: number; trigger?: string; executorRef?: string;
	}>) {
	let persisted = initial;
	const attempt = recovery?.attempt ?? 1;
	mocks.updateNodeRun.mockImplementation(async (_db: unknown, params: Readonly<{ outputCheckpoint?: WorkflowOutputCheckpointWrite }>) => {
		if (params.outputCheckpoint) {
			const root = persisted === null ? null : workflowOutputRootHash(persisted);
			if (root !== params.outputCheckpoint.baseRootHash) throw new Error("prepared recovery base changed");
			persisted = params.outputCheckpoint.output;
		}
	});
	const requests: Readonly<{ path: string; body: Record<string, unknown> }>[] = [];
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const path = new URL(String(input)).pathname;
		const body: Record<string, unknown> = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
		requests.push({ path, body });
		if (path === "/nodeCheckpointObservation" && observationFails) return new Response("observation write unavailable", { status: 500 });
		if (path === "/nodeProgress" && body.progressKind === "output_checkpoint") {
			if (failure === "stale") return new Response("workflow_output_checkpoint_stale_base", { status: 409 });
			persisted = applyWorkflowOutputCheckpointPacket(persisted, parseWorkflowOutputCheckpointPacket(body.outputCheckpoint));
			if (failure === "ack_unknown") throw new Error("checkpoint committed; acknowledgement unavailable");
		}
		return new Response("accepted", { status: 202 });
	});
	const node = { id: "node-1", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: {
		version: 1, category: "agent", operation: "agent_task", executorRef: recovery?.executorRef ?? "agents.logical-task/v2",
		executionMode: "once", inputPorts: [], outputPorts: ["result"],
	} } };
	const env = {
		DB: {
			workflow_executions: { findUnique: vi.fn(async () => ({ flow_version_id: "version-1", flow_id: "flow-1",
				owner_id: "owner-1", execution_family_id: "family-1", recovery_of_execution_id: null })) },
			flow_versions: { findUnique: vi.fn(async () => ({ data: JSON.stringify({ nodes: [node], edges: [] }) })) },
			flows: { findUnique: vi.fn(async () => ({ project_id: null })) },
			workflow_execution_events: { findMany: vi.fn(async () => recovery?.events ?? []) },
			workflow_node_attempts: { findMany: vi.fn(async () => [
				{ attempt, trigger: recovery?.trigger ?? "initial" },
				...(attempt > 1 ? [{ attempt: attempt - 1, trigger: "initial" }] : []),
			]) },
			workflow_node_runs: {
				findMany: vi.fn(async () => []),
				findUnique: vi.fn(async () => ({ id: "node-run-1", attempt,
					output_refs: persisted === null ? null : JSON.stringify(persisted) })),
			},
		},
		EXECUTION_DO: { idFromName: (id: string) => ({ toString: () => id }), get: () => ({ fetch }) },
		WORKFLOW_NODE_QUEUE: { send: vi.fn(async () => undefined) },
	} as unknown as WorkerEnv;
	return { env, requests, persisted: () => persisted };
}

const job = { executionId: "execution-1", nodeId: "node-1", nodeRunId: "node-run-1", attempt: 1 };
beforeEach(() => { vi.clearAllMocks(); });

describe("workflow queue checkpoint writer boundaries", () => {
	it("starts an external poll from the authoritative stored envelope without resending its accepted body", async () => {
		const initial = encodeWorkflowOutput(receipt());
		const runtime = fixture(initial);
		mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext) => {
			const output = { ...receipt(), evidence: { ...receipt().evidence, completedItems: 1 } };
			await context.checkpointOutputRefs?.(output);
			return { ok: true, outputRefs: output };
		});
		await handleWorkflowNodeJob(runtime.env, { ...job, phase: "await_external" });
		const progress = runtime.requests.find(request => request.path === "/nodeProgress")!;
		const packet = parseWorkflowOutputCheckpointPacket(progress.body.outputCheckpoint);
		expect(packet.baseRootHash).toBe(workflowOutputRootHash(initial));
		expect(JSON.stringify(packet).includes(String(receipt().evidence.authorBody))).toBe(false);
	});

	it.each(["success", "waiting", "failure"] as const)("never converts a swallowed rejected checkpoint into a %s lifecycle write", async resultKind => {
		const runtime = fixture(null, "stale");
		mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			await context.checkpointOutputRefs?.(receipt()).catch(() => undefined);
			const retained = { ...receipt(), evidence: { taskId: "accepted-sibling-returned-after-failure" } };
			if (resultKind === "success") return { ok: true, outputRefs: retained };
			if (resultKind === "waiting") {
				const externalCheck = { version: 1 as const, mode: "poll" as const, notBeforeAt: new Date(Date.now() + 5_000).toISOString() };
				return { ok: false, waitingExternal: true, outputRefs: retained, externalCheck };
			}
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "retained failure", outputRefs: retained };
		});
		await expect(handleWorkflowNodeJob(runtime.env, job)).rejects.toMatchObject({ name: "WorkflowOutputCheckpointWriterError" });
		expect(runtime.requests.filter(request => request.path === "/nodeWaiting" || request.path === "/nodeComplete")).toEqual([]);
		expect(runtime.requests.filter(request => request.path === "/nodeProgress")).toHaveLength(1);
		const observation = runtime.requests.find(request => request.path === "/nodeCheckpointObservation")!;
		expect(JSON.stringify(observation.body.snapshots).includes("accepted-sibling-returned-after-failure")).toBe(true);
	});

	it("keeps a committed but unacknowledged receipt without broadcasting a completion or retrying another callback", async () => {
		const runtime = fixture(null, "ack_unknown");
		mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext) => {
			await context.checkpointOutputRefs?.(receipt()).catch(() => undefined);
			await context.checkpointOutputRefs?.({ ...receipt(), evidence: { taskId: "concurrently-accepted-sibling" } }).catch(() => undefined);
			return { ok: true, outputRefs: receipt() };
		});
		await expect(handleWorkflowNodeJob(runtime.env, job)).rejects.toMatchObject({ name: "WorkflowOutputCheckpointWriterError" });
		expect(runtime.persisted()).not.toBeNull();
		expect(runtime.requests.filter(request => request.path === "/nodeProgress")).toHaveLength(1);
		expect(runtime.requests.filter(request => request.path === "/nodeWaiting" || request.path === "/nodeComplete")).toEqual([]);
		expect(JSON.stringify(runtime.requests.filter(request => request.path === "/nodeProgress")).includes("concurrently-accepted-sibling")).toBe(false);
		const observation = runtime.requests.find(request => request.path === "/nodeCheckpointObservation")!;
		expect(JSON.stringify(observation.body.snapshots).includes("concurrently-accepted-sibling")).toBe(true);
	});

	it("settles unawaited callbacks before accepting an executor success", async () => {
		const runtime = fixture(null, "stale");
		mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext) => {
			void context.checkpointOutputRefs?.(receipt()).catch(() => undefined);
			return { ok: true, outputRefs: receipt() };
		});
		await expect(handleWorkflowNodeJob(runtime.env, job)).rejects.toMatchObject({ name: "WorkflowOutputCheckpointWriterError" });
		expect(runtime.requests.filter(request => request.path === "/nodeWaiting" || request.path === "/nodeComplete")).toEqual([]);
	});

	it("reports failed observation retention while keeping the writer failure explicit and preventing lifecycle writes", async () => {
		const runtime = fixture(null, "ack_unknown", true);
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext) => {
			await context.checkpointOutputRefs?.(receipt());
			return { ok: true, outputRefs: receipt() };
		});
		try {
			await expect(handleWorkflowNodeJob(runtime.env, job)).rejects.toMatchObject({ name: "WorkflowOutputCheckpointWriterError" });
			expect(runtime.requests.filter(request => request.path === "/nodeCheckpointObservation")).toHaveLength(1);
			expect(runtime.requests.filter(request => request.path === "/nodeWaiting" || request.path === "/nodeComplete")).toEqual([]);
			expect(diagnostic.mock.calls.some(([message]) => JSON.parse(String(message)).message === "workflow_node_checkpoint_observation_failed")).toBe(true);
		} finally { diagnostic.mockRestore(); }
	});

	it.each(["before_commit", "ack_unknown", "automatic_prior_attempt"] as const)("resumes the original provider receipt after %s without resubmitting", async boundary => {
		const retained = receipt();
		const attempt = boundary === "automatic_prior_attempt" ? 2 : 1;
		const event = { id: "observation-1", seq: 8, event_type: "node_checkpoint_observation",
			data: JSON.stringify({ nodeRunId: "node-run-1", attempt: 1, baseRootHash: null,
				failureReason: "checkpoint acknowledgement unavailable", snapshots: [retained], terminalAuthority: false }) };
		const runtime = fixture(boundary === "ack_unknown" ? encodeWorkflowOutput(retained) : null,
			null, false, { events: [event], attempt, trigger: attempt === 2 ? "runtime_recovery" : "initial" });
		const paidSubmit = vi.fn();
		mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext) => {
			if (!context.resumeOnly || !context.resumeOutputRefs?.evidence.taskId) paidSubmit();
			expect(context.resumeOnly).toBe(true);
			expect(context.resumeOutputRefs?.evidence.taskId).toBe("already-accepted");
			return { ok: true, outputRefs: context.resumeOutputRefs! };
		});
		await handleWorkflowNodeJob(runtime.env, { ...job, attempt, phase: attempt === 2 ? "recover" : "await_external" });
		expect(paidSubmit).not.toHaveBeenCalled();
		expect(mocks.insertEvent).toHaveBeenCalledWith(runtime.env.DB, expect.objectContaining({
			eventType: "node_checkpoint_observation_recovered", data: expect.objectContaining({ sourceAttempt: 1, attempt }),
		}));
		const promotions = mocks.updateNodeRun.mock.calls.filter(([, params]) => params.outputCheckpoint);
		expect(promotions).toHaveLength(boundary === "ack_unknown" ? 0 : 1);
		expect(runtime.requests.some(request => request.path === "/nodeComplete")).toBe(true);
	});

	it("releases a divergent retained-receipt recovery before any provider executor or lifecycle write", async () => {
		const newer = encodeWorkflowOutput({ ...receipt(), evidence: { taskId: "newer-accepted-task" } });
		const event = { id: "observation-1", seq: 8, event_type: "node_checkpoint_observation",
			data: JSON.stringify({ nodeRunId: "node-run-1", attempt: 1, baseRootHash: null,
				failureReason: "checkpoint unavailable", snapshots: [receipt()], terminalAuthority: false }) };
		const runtime = fixture(newer, null, false, { events: [event] });
		await expect(handleWorkflowNodeJob(runtime.env, { ...job, phase: "await_external" })).rejects.toMatchObject({
			name: "WorkflowCheckpointRecoveryConflict", reason: "base_root_changed",
		});
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(runtime.requests.map(request => request.path)).toEqual(["/nodeExternalCheckStarted"]);
	});

	it("recovers a real unknown callback commit followed by a newly stamped retained failure candidate", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-30T11:00:00.000Z"));
		try {
			const first = fixture(null, "ack_unknown");
			mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
				await context.checkpointOutputRefs?.(receipt()).catch(() => undefined);
				vi.setSystemTime(new Date("2026-09-30T11:00:01.000Z"));
				return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "checkpoint acknowledgement unavailable",
					outputRefs: { ...receipt(), evidence: { ...receipt().evidence,
						checkpointPersistenceFailure: { recoverable: false, message: "checkpoint acknowledgement unavailable" } } } };
			});
			await expect(handleWorkflowNodeJob(first.env, job)).rejects.toMatchObject({ name: "WorkflowOutputCheckpointWriterError" });
			const observation = first.requests.find(request => request.path === "/nodeCheckpointObservation")!;
			const event = { id: "observed-real-physical-writer", seq: 8, event_type: "node_checkpoint_observation",
				data: JSON.stringify({ ...observation.body, terminalAuthority: false }) };
			const next = fixture(first.persisted(), null, false, { events: [event] });
			const paidSubmit = vi.fn();
			mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext) => {
				if (!context.resumeOnly || context.resumeOutputRefs?.evidence.taskId !== "already-accepted") paidSubmit();
				expect(context.resumeOutputRefs?.evidence.checkpointPersistenceFailure).toMatchObject({ recoverable: false });
				return { ok: true, outputRefs: context.resumeOutputRefs! };
			});
			await handleWorkflowNodeJob(next.env, { ...job, phase: "await_external" });
			expect(paidSubmit).not.toHaveBeenCalled();
			expect(mocks.insertEvent).toHaveBeenCalledWith(next.env.DB, expect.objectContaining({
				data: expect.objectContaining({ matchedSnapshotIndex: 0, disposition: "promote" }),
			}));
		} finally { vi.useRealTimers(); }
	});
	it("keeps automatic resumeOnly after a consumed marker and preserves an unstarted accepted collection sibling on callback failure", async () => {
		const externalCheck = { version: 1 as const, mode: "poll" as const, notBeforeAt: new Date(Date.now() + 5_000).toISOString() };
		const retained: WorkflowNodeOutputV1 = { ...receipt(), executorRef: "tapcanvas.image.generate/v1", executionMode: "each",
			itemRuns: ["a", "b"].map((id, index) => ({ itemId: id, index, runtimeNodeId: `node-1::item::${id}`,
				lineage: [], status: "waiting_external", ports: {}, artifacts: [], evidence: { taskId: `accepted-${id}` }, externalCheck })) };
		const stored = encodeWorkflowOutput(retained);
		const rows = [
			{ id: "observation-1", seq: 7, event_type: "node_checkpoint_observation", data: JSON.stringify({
				nodeRunId: "node-run-1", attempt: 1, baseRootHash: null, snapshots: [retained],
				failureReason: "acknowledgement unavailable", terminalAuthority: false }) },
			{ id: "marker-1", seq: 8, event_type: "node_checkpoint_observation_recovered", data: JSON.stringify({
				nodeRunId: "node-run-1", attempt: 1, sourceAttempt: 1, observationSeq: 7,
				candidateRootHash: workflowOutputRootHash(stored), disposition: "already_committed", terminalAuthority: false }) },
		];
		const runtime = fixture(stored, "stale", false, { events: rows, attempt: 2, trigger: "runtime_recovery",
			executorRef: "tapcanvas.image.generate/v1" });
		const paidSubmit = vi.fn();
		const once = vi.fn(async (item: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			if (!item.resumeOnly) paidSubmit();
			expect(item.resumeOnly).toBe(true);
			return { ok: false, waitingExternal: true, externalCheck, outputRefs: { ...receipt(),
				nodeId: item.node.id, executorRef: "tapcanvas.image.generate/v1", externalCheck,
				evidence: { taskId: "accepted-a" } } };
		});
		mocks.execute.mockImplementationOnce(async (context: WorkflowNodeExecutionContext, dependencies: WorkflowNodeExecutorDependencies) => {
			expect(context.resumeOnly).toBe(true);
			return executeWorkflowNodeByMode({ ...context, node: { ...context.node, data: { ...context.node.data,
				workflowAtomicSpec: { version: 1, category: "media", operation: "image_generate", executorRef: "tapcanvas.image.generate/v1",
					executionMode: "each", itemConcurrency: 1, inputPorts: ["items"], outputPorts: ["result"] } } },
				inputs: { items: [createWorkflowCollection({ collectionId: "items", producerNodeId: "source", producerPortId: "items",
					values: ["a", "b"], itemIds: ["a", "b"] })] } }, dependencies, once);
		});
		await expect(handleWorkflowNodeJob(runtime.env, { ...job, attempt: 2, phase: "execute" }))
			.rejects.toMatchObject({ name: "WorkflowOutputCheckpointWriterError" });
		expect(once).toHaveBeenCalledTimes(1); expect(paidSubmit).not.toHaveBeenCalled();
		const observed = runtime.requests.find(request => request.path === "/nodeCheckpointObservation")!;
		const snapshots = observed.body.snapshots as readonly WorkflowNodeOutputV1[];
		expect(snapshots.at(-1)?.itemRuns.map(run => run.evidence.taskId)).toEqual(["accepted-a", "accepted-b"]);
		expect(runtime.requests.some(request => request.path === "/nodeWaiting" || request.path === "/nodeComplete")).toBe(false);
	});

});
