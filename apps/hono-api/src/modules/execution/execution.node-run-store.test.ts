import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
	type WorkflowExecutionSemanticsV2,
} from "@tapcanvas/workflow-kernel-protocol";

const replaySemantics: WorkflowExecutionSemanticsV2 = {
	protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
	sideEffect: "none",
	retrySafety: "safe",
	executionMode: "parallel_safe",
	idempotency: null,
	resultLookup: { mode: "none", outputField: null },
	recoveryMode: "replay",
	maxAutomaticAttempts: 3,
	backoffClass: "bounded_exponential",
	failureStage: "input",
};

const paidSemantics: WorkflowExecutionSemanticsV2 = {
	protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
	sideEffect: "paid_generation",
	retrySafety: "idempotency_key_required",
	executionMode: "exclusive",
	idempotency: { source: "runtime_node", inputField: null },
	resultLookup: { mode: "provider_receipt", outputField: "taskId" },
	recoveryMode: "reconcile",
	maxAutomaticAttempts: 1,
	backoffClass: "none",
	failureStage: "media_generation",
};

function nodeRun(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: "node-run-1",
		execution_id: "execution-1",
		node_id: "node-1",
		status: "pending",
		attempt: 1,
		error_message: null,
		error_code: null,
		failure_stage: null,
		input_refs: null,
		output_refs: null,
		tool_calls: null,
		retry_count: 0,
		node_type: null,
		tool_name: null,
		model_key: null,
		created_at: "2026-08-20T01:00:00.000Z",
		started_at: null,
		finished_at: null,
		...overrides,
	};
}

type CheckpointGuardRow = Readonly<{ id: string; attempt: number; output_refs: string | null }>;
let checkpointGuardRows: () => readonly CheckpointGuardRow[];
function checkpointGuardOutput(output_refs: string | null): void {
	checkpointGuardRows = () => [{ id: "node-run-1", attempt: 1, output_refs }];
}
async function queryOutputStore(query: { sql: string; values: unknown[] }): Promise<unknown[]> {
	if (query.sql.includes("SELECT id, attempt, output_refs")) return [...checkpointGuardRows()];
	return query.sql.includes("FOR UPDATE") ? [{ block_ids: [], storage_version: null }] : [{ output_bytes: 123 }];
}
const transaction = {
	$queryRaw: vi.fn(queryOutputStore),
	$executeRaw: vi.fn(async (_query: { sql: string; values: unknown[] }) => 1),
	workflow_executions: { findUnique: vi.fn(), update: vi.fn() },
	workflow_node_runs: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
	workflow_node_attempts: {
		createMany: vi.fn(),
		count: vi.fn(),
		findUnique: vi.fn(),
		update: vi.fn(),
		create: vi.fn(),
	},
};

const prismaMock = {
	workflow_executions: transaction.workflow_executions,
	$transaction: vi.fn(async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction)),
};

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prismaMock }));

import { ensureNodeRuns, incrementNodeRunAttempt, updateNodeRun, updateNodeRuns } from "./execution.node-run-store";
import * as outputStorage from "./execution.output-storage";
import * as outputStore from "./execution.output-storage-store";
import { workflowOutputRootHash } from "./execution.output-checkpoint-packet";

beforeEach(() => {
	vi.resetAllMocks();
	checkpointGuardOutput(null);
	transaction.$queryRaw.mockImplementation(queryOutputStore);
	transaction.$executeRaw.mockResolvedValue(1);
	prismaMock.$transaction.mockImplementation(async operation => operation(transaction));
});

describe("workflow node attempt ledger", () => {
	it("creates the initial attempt together with the current node-run projection", async () => {
		transaction.workflow_executions.findUnique.mockResolvedValue({
			execution_family_id: "execution-1",
			recovery_of_execution_id: null,
			flow_versions: {
				data: JSON.stringify({
					nodes: [{ id: "node-1", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.input/v1" } } }],
					workflowExecutionSemantics: {
						protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
						nodes: { "node-1": { executorRef: "workflow.input/v1", semantics: replaySemantics } },
					},
				}),
			},
		});
		transaction.workflow_node_runs.upsert.mockResolvedValue(nodeRun());
		transaction.workflow_node_attempts.createMany.mockResolvedValue({ count: 1 });
		transaction.workflow_node_attempts.count.mockResolvedValue(1);

		await ensureNodeRuns({} as never, {
			executionId: "execution-1",
			nodeIds: ["node-1"],
			nowIso: "2026-08-20T01:00:00.000Z",
		});

		expect(transaction.workflow_node_attempts.createMany).toHaveBeenCalledWith({
			data: [expect.objectContaining({
				execution_family_id: "execution-1",
				node_run_id: "node-run-1",
				attempt: 1,
				trigger: "initial",
			})],
			skipDuplicates: true,
		});
	});

	it("mirrors lifecycle facts and appends declared provider receipts", async () => {
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun({
			status: "waiting_external",
			output_refs: JSON.stringify({ evidence: { taskId: "provider-new" } }),
		}));
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(paidSemantics),
			provider_receipts: JSON.stringify(["provider-old"]),
		});

		await updateNodeRun({} as never, {
			executionId: "execution-1",
			nodeId: "node-1",
			status: "waiting_external",
			outputRefs: { evidence: { taskId: "provider-new" } },
		});

		const query = transaction.$executeRaw.mock.calls[0]![0];
		expect(query.sql).toContain('"status" = n."status"');
		expect(query.sql).toContain('"output_refs" = n."output_refs"');
		expect(query.values).toContain(JSON.stringify(["provider-old", "provider-new"]));
	});

	it("persists large aggregate output and retains every declared receipt beyond the old traversal cutoff", async () => {
		const output = { itemRuns: Array.from({ length: 25_000 }, (_, index) => ({
			evidence: { taskId: `provider-${index}`, payload: { values: [index, "retained"] } },
		})) };
		const serialized = JSON.stringify(output);
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun({ status: "success", output_refs: serialized }));
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: JSON.stringify(["provider-old"]),
		});
		await updateNodeRun({} as never, { executionId: "execution-1", nodeId: "node-1", status: "success", outputRefs: output });
		const query = transaction.$executeRaw.mock.calls[0]![0];
		expect(query.sql).toContain('"output_refs" = n."output_refs"');
		expect(query.values).not.toContain(serialized);
		expect(query.values).toContain(JSON.stringify(["provider-old", ...output.itemRuns.map((item) => item.evidence.taskId)]));
	});

	it("reports the failed persistence phase without exposing output and rethrows the original error", async () => {
		const failure = Object.assign(new Error("transaction expired"), { code: "P2028" });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun());
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(replaySemantics), provider_receipts: null,
		});
		transaction.$executeRaw.mockRejectedValueOnce(failure);
		try {
			await expect(updateNodeRun({} as never, {
				executionId: "execution-1", nodeId: "node-1", outputRefs: { privateText: "不得记录" },
			})).rejects.toMatchObject({ name: "WorkflowPersistenceError", cause: failure, recoverable: true });
			const diagnostic = JSON.parse(warn.mock.calls[0]![0] as string) as Record<string, unknown>;
			expect(diagnostic).toMatchObject({
				message: "workflow_node_persistence_timing", outcome: "failed",
				lastPhase: "update_attempt", errorCodes: ["P2028"],
			});
			expect(JSON.stringify(diagnostic)).not.toContain("不得记录");
			expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	it("includes preparation phases and existing serialized sizes without logging private bodies", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun());
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(replaySemantics), provider_receipts: null,
		});
		const inputRefs = { privateText: "准备阶段私有中文" };
		const toolCalls = [{ tool: "private-tool", body: "私有调用" }];
		try {
			await updateNodeRun({} as never, {
				executionId: "execution-1", nodeId: "node-1", inputRefs, toolCalls,
				outputRefs: { retained: "body".repeat(300) },
			});
			const diagnostic = JSON.parse(warn.mock.calls[0]![0] as string) as {
				elapsedMs: number; preparationElapsedMs: number; phaseDurationsMs: Record<string, number>;
				preparationSize: { inputRefsBytes: number; toolCallsBytes: number; suppliedOutputStringBytes: number | null; outputStorageBlockCount: number };
			};
			expect(diagnostic.preparationSize).toMatchObject({
				inputRefsBytes: Buffer.byteLength(JSON.stringify(inputRefs)),
				toolCallsBytes: Buffer.byteLength(JSON.stringify(toolCalls)),
				suppliedOutputStringBytes: null,
			});
			expect(diagnostic.preparationSize.outputStorageBlockCount).toBeGreaterThan(0);
			for (const phase of ["prepare_mutation", "prepare_output_decode", "prepare_output_encode", "prepare_size_diagnostics"]) {
				expect(diagnostic.phaseDurationsMs[phase]).toBeGreaterThanOrEqual(0);
			}
			expect(diagnostic.elapsedMs).toBeGreaterThanOrEqual(diagnostic.preparationElapsedMs);
			expect(JSON.stringify(diagnostic)).not.toContain("私有");
			expect(JSON.stringify(diagnostic)).not.toContain("private-tool");
		} finally {
			warn.mockRestore();
		}
	});

	it("reports failed preparation and preserves a structural error before opening a transaction", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await expect(updateNodeRun({} as never, {
				executionId: "execution-1", nodeId: "node-1", inputRefs: { value: 1n },
			})).rejects.toThrow("Workflow node inputRefs is not JSON serializable");
			expect(prismaMock.$transaction).not.toHaveBeenCalled();
			expect(JSON.parse(warn.mock.calls[0]![0] as string)).toMatchObject({
				outcome: "failed", lastPhase: "prepare_mutation", errorCodes: [],
			});
		} finally {
			warn.mockRestore();
		}
	});

	it("settles the previous attempt before creating a distinct retry row", async () => {
		transaction.workflow_node_runs.findUnique.mockResolvedValue(nodeRun({ status: "running" }));
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			execution_family_id: "execution-1",
			semantics_snapshot: JSON.stringify(replaySemantics),
			provider_receipts: null,
		});
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun({ status: "pending", attempt: 2, retry_count: 1 }));
		transaction.workflow_node_attempts.create.mockResolvedValue({ id: "attempt-2" });

		const nextAttempt = await incrementNodeRunAttempt({} as never, {
			executionId: "execution-1",
			nodeId: "node-1",
			trigger: "automatic_retry",
			nextStatus: "pending",
			previousErrorMessage: "temporary failure",
			previousErrorCode: "temporary_failure",
			failureStage: "input",
			nowIso: "2026-08-20T01:01:00.000Z",
		});

		expect(nextAttempt).toBe(2);
		expect(transaction.workflow_node_attempts.update).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({ status: "failed", error_code: "temporary_failure" }),
		}));
		expect(transaction.workflow_node_attempts.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ attempt: 2, trigger: "automatic_retry", status: "pending" }),
		});
		expect(transaction.workflow_executions.update).toHaveBeenCalledWith({
			where: { id: "execution-1" },
			data: { retry_count: { increment: 1 } },
		});
	});

	it("records runtime recovery as a new attempt without inflating retry counters", async () => {
		transaction.workflow_node_runs.findUnique.mockResolvedValue(nodeRun({ status: "running" }));
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			execution_family_id: "execution-1",
			semantics_snapshot: JSON.stringify(replaySemantics),
			provider_receipts: null,
		});
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun({ status: "queued", attempt: 2, retry_count: 0 }));
		transaction.workflow_node_attempts.create.mockResolvedValue({ id: "attempt-2" });

		await incrementNodeRunAttempt({} as never, {
			executionId: "execution-1",
			nodeId: "node-1",
			trigger: "runtime_recovery",
			nextStatus: "queued",
			previousErrorMessage: "runtime restarted",
			previousErrorCode: "workflow_runtime_restarted",
			failureStage: "execution",
			nowIso: "2026-08-20T01:02:00.000Z",
		});

		expect(transaction.workflow_node_runs.update).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({
				error_message: null,
				error_code: null,
				failure_stage: null,
				finished_at: null,
			}),
		}));
		expect(transaction.workflow_node_runs.update).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.not.objectContaining({ retry_count: expect.anything() }),
		}));
		expect(transaction.workflow_node_attempts.update).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({
				status: "failed",
				error_message: "runtime restarted",
				error_code: "workflow_runtime_restarted",
			}),
		}));
		expect(transaction.workflow_executions.update).not.toHaveBeenCalled();
	});
});

it("status-only checkpoints preserve stored payloads and receipts without round-tripping them", async () => {
  transaction.workflow_node_runs.update.mockResolvedValue({ id: 'node-run-1', attempt: 1 });
  transaction.workflow_node_attempts.findUnique.mockResolvedValue({ semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: '["accepted"]' });
  await updateNodeRun({} as never, { executionId: 'execution-1', nodeId: 'node-1', status: 'running', retryCount: 1 });
  expect(transaction.workflow_node_runs.update).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, attempt: true } }));
  expect(transaction.$queryRaw).not.toHaveBeenCalled();
  const query = transaction.$executeRaw.mock.calls[0]![0];
  expect(query.sql).toContain('"status" = n."status"');
  expect(query.sql).not.toContain('output_refs');
  expect(query.sql).not.toContain('provider_receipts');
});

describe("prepared workflow output checkpoints", () => {
	it.each([null, outputStorage.encodeWorkflowOutput({ taskId: "accepted" })])("locks an empty guard-only mutation before reading base %j", async base => {
		checkpointGuardOutput(base === null ? null : JSON.stringify(base));
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun());
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: '["accepted"]',
		});
		await updateNodeRun({} as never, { executionId: "execution-1", nodeId: "node-1",
			outputCheckpoint: { output: null, nodeRunId: "node-run-1", attempt: 1,
				baseRootHash: base === null ? null : workflowOutputRootHash(base) } });
		const guard = transaction.$queryRaw.mock.calls[0]![0];
		expect(guard.sql).toContain("FOR UPDATE");
		expect(guard.sql).toContain("execution_id =");
		expect(guard.sql).toContain("node_id =");
		expect(guard.values).toEqual(["execution-1", "node-1", "node-run-1", 1]);
		expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(transaction.workflow_node_runs.update.mock.invocationCallOrder[0]!);
		expect(transaction.workflow_node_runs.update.mock.calls[0]![0].data).toEqual({});
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		expect(transaction.$executeRaw).not.toHaveBeenCalled();
	});

	it("serializes competing empty-mutation checkpoint writers before reading their base and rejects the stale sibling", async () => {
		const base = outputStorage.encodeWorkflowOutput({ taskId: "original" });
		const outputs = [outputStorage.encodeWorkflowOutput({ taskId: "accepted-first" }), outputStorage.encodeWorkflowOutput({ taskId: "accepted-second" })];
		let persisted = JSON.stringify(base);
		let lockTail = Promise.resolve();
		let admitted = 0;
		const reads: number[] = [];
		let announceFirst = (): void => {};
		const firstLocked = new Promise<void>(resolve => { announceFirst = resolve; });
		let announceSecond = (): void => {};
		const secondQueued = new Promise<void>(resolve => { announceSecond = resolve; });
		let continueFirst = (): void => {};
		const firstMayPersist = new Promise<void>(resolve => { continueFirst = resolve; });
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({ semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: '["original"]' });
		prismaMock.$transaction.mockImplementation(async operation => {
			const index = admitted++;
			let release = (): void => {};
			let locked = false;
			const client = { ...transaction,
				$queryRaw: vi.fn(async (query: { sql: string; values: unknown[] }): Promise<unknown[]> => {
					if (query.sql.includes("SELECT id, attempt, output_refs")) {
						expect(query.sql).toContain("FOR UPDATE");
						const previous = lockTail;
						lockTail = new Promise<void>(resolve => { release = resolve; });
						if (index === 1) announceSecond();
						await previous;
						locked = true; reads.push(index);
						if (index === 0) announceFirst();
						return [{ id: "node-run-1", attempt: 1, output_refs: persisted }];
					}
					expect(locked).toBe(true);
					if (query.sql.includes("FOR UPDATE")) return [{ block_ids: [], storage_version: null }];
					persisted = JSON.stringify(outputs[index]);
					return [{ output_bytes: persisted.length }];
				}),
				workflow_node_runs: { ...transaction.workflow_node_runs, update: vi.fn(async () => {
					expect(locked).toBe(true);
					if (index === 0) await firstMayPersist;
					return { id: "node-run-1", attempt: 1 };
				}) },
			};
			try { return await operation(client); } finally { release(); }
		});
		const params = { executionId: "execution-1", nodeId: "node-1" };
		const write = (output: outputStorage.StoredWorkflowOutput) => updateNodeRun({} as never, { ...params,
			outputCheckpoint: { output, nodeRunId: "node-run-1", attempt: 1, baseRootHash: workflowOutputRootHash(base) } });
		const first = write(outputs[0]!);
		await firstLocked;
		const second = write(outputs[1]!);
		const results = Promise.allSettled([first, second]);
		await secondQueued;
		expect(reads).toEqual([0]);
		continueFirst();
		const settled = await results;
		expect(settled[0]?.status).toBe("fulfilled");
		expect(settled[1]).toMatchObject({ status: "rejected", reason: { name: "WorkflowOutputCheckpointStaleError", reason: "base_root_changed" } });
		expect(reads).toEqual([0, 1]);
		expect(persisted).toBe(JSON.stringify(outputs[0]));
		expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
	});

	it("keeps a post-lock P2025 attempt fence miss typed and leaves output untouched", async () => {
		const missing = Object.assign(new Error("attempt changed"), { code: "P2025" });
		transaction.workflow_node_runs.update.mockRejectedValueOnce(missing);
		await expect(updateNodeRun({} as never, { executionId: "execution-1", nodeId: "node-1",
			outputCheckpoint: { output: null, nodeRunId: "node-run-1", attempt: 1, baseRootHash: null } }))
			.rejects.toMatchObject({ name: "WorkflowOutputCheckpointStaleError", reason: "attempt_changed", cause: missing });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		expect(transaction.$executeRaw).not.toHaveBeenCalled();
	});

	it.each([null, outputStorage.encodeWorkflowOutput({ taskId: "accepted-retained" })])("guards lifecycle state without writing output for base %j", async (base) => {
		checkpointGuardOutput(base === null ? null : JSON.stringify(base));
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun({ output_refs: base === null ? null : JSON.stringify(base) }));
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: '["accepted-retained"]',
		});
		await updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1", status: "failed", errorCode: "runtime_action_failed",
			outputCheckpoint: { output: null, nodeRunId: "node-run-1", attempt: 1, baseRootHash: base === null ? null : workflowOutputRootHash(base) },
		});
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		expect(transaction.$queryRaw.mock.calls[0]![0].sql).toContain("SELECT id, attempt, output_refs");
		const mirror = transaction.$executeRaw.mock.calls[0]![0];
		expect(mirror.sql).toContain('"status" = n."status"');
		expect(mirror.sql).not.toContain("output_refs");
		expect(mirror.sql).not.toContain("provider_receipts");
	});

	it.each(["original_hash", null])("rolls back a guard-only lifecycle write when its acknowledged base %s changed", async (expected) => {
		const base = outputStorage.encodeWorkflowOutput({ taskId: "original" });
		const current = outputStorage.encodeWorkflowOutput({ taskId: "newer-accepted" });
		const persisted = { status: "waiting_external", output_refs: JSON.stringify(current) };
		checkpointGuardOutput(persisted.output_refs);
		transaction.workflow_node_runs.update.mockImplementationOnce(async (input: { data: { status?: string } }) => {
			persisted.status = input.data.status ?? persisted.status;
			return nodeRun(persisted);
		});
		prismaMock.$transaction.mockImplementationOnce(async (operation) => {
			const before = { ...persisted };
			try { return await operation(transaction); }
			catch (error: unknown) { Object.assign(persisted, before); throw error; }
		});
		await expect(updateNodeRun({} as never, { executionId: "execution-1", nodeId: "node-1", status: "failed",
			outputCheckpoint: { output: null, nodeRunId: "node-run-1", attempt: 1, baseRootHash: expected === null ? null : workflowOutputRootHash(base) },
		})).rejects.toMatchObject({ name: "WorkflowOutputCheckpointStaleError", reason: "base_root_changed" });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		expect(transaction.workflow_node_runs.update).not.toHaveBeenCalled();
		expect(transaction.$executeRaw).not.toHaveBeenCalled();
		expect(persisted).toEqual({ status: "waiting_external", output_refs: JSON.stringify(current) });
	});

	it("persists a patched envelope directly while atomically retaining every accepted receipt", async () => {
		const base = outputStorage.encodeWorkflowOutput({
			itemRuns: Array.from({ length: 25_000 }, (_, index) => ({
				evidence: { taskId: `accepted-${index}`, payload: "retained".repeat(100) },
			})),
		});
		const prepared = outputStorage.patchWorkflowOutput(base, [{
			kind: "add", path: ["observation"], value: { taskId: "new-observation", status: "waiting_external" },
		}]).output;
		checkpointGuardOutput(JSON.stringify(base));
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun({ output_refs: JSON.stringify(base) }));
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: '["prior-receipt"]',
		});
		transaction.$queryRaw.mockImplementation(async query => query.sql.includes("block_ids")
			? [{ block_ids: Object.keys(base.blocks), storage_version: base.storageVersion }] : queryOutputStore(query));
		// Keep the real SQL storage path; spies observe the prepared identity and
		// cold encoder without replacing persistence or validation behavior.
		const encode = vi.spyOn(outputStorage, "encodeWorkflowOutput");
		const persist = vi.spyOn(outputStore, "persistWorkflowOutput");
		try {
			await updateNodeRun({} as never, {
				executionId: "execution-1", nodeId: "node-1", status: "waiting_external",
				outputCheckpoint: { output: prepared, nodeRunId: "node-run-1", attempt: 1, baseRootHash: workflowOutputRootHash(base) },
			});
			expect(encode).not.toHaveBeenCalled();
			expect(persist).toHaveBeenCalledWith(transaction, "node-run-1", prepared);
			expect(persist.mock.calls[0]![2]).toBe(prepared);
			expect(transaction.workflow_node_runs.update).toHaveBeenCalledWith({
				where: { execution_id_node_id: { execution_id: "execution-1", node_id: "node-1" }, id: "node-run-1", attempt: 1 },
				data: { status: "waiting_external" }, select: { id: true, attempt: true },
			});
			const mirror = transaction.$executeRaw.mock.calls[0]![0];
			expect(mirror.sql).toContain('"status" = n."status"');
			expect(mirror.sql).toContain('"output_refs" = n."output_refs"');
			expect(mirror.values).toContain(JSON.stringify([
				"prior-receipt", "new-observation", ...Array.from({ length: 25_000 }, (_, index) => `accepted-${index}`),
			]));
		} finally {
			encode.mockRestore();
			persist.mockRestore();
		}
	});

	it("rejects a changed base before writing output or mirroring the attempt", async () => {
		const base = outputStorage.encodeWorkflowOutput({ taskId: "accepted-original" });
		const changed = outputStorage.encodeWorkflowOutput({ taskId: "accepted-current" });
		const persisted = { status: "waiting_external", output_refs: JSON.stringify(changed) };
		checkpointGuardOutput(persisted.output_refs);
		transaction.workflow_node_runs.update.mockImplementationOnce(async (input: { data: { status?: string } }) => {
			persisted.status = input.data.status ?? persisted.status;
			return nodeRun(persisted);
		});
		prismaMock.$transaction.mockImplementationOnce(async (operation) => {
			const before = { ...persisted };
			try { return await operation(transaction); }
			catch (error: unknown) { Object.assign(persisted, before); throw error; }
		});
		await expect(updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1", status: "running",
			outputCheckpoint: { output: base, nodeRunId: "node-run-1", attempt: 1, baseRootHash: workflowOutputRootHash(base) },
		})).rejects.toMatchObject({ name: "WorkflowOutputCheckpointStaleError", code: "workflow_output_checkpoint_stale", reason: "base_root_changed" });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		expect(transaction.workflow_node_runs.update).not.toHaveBeenCalled();
		expect(transaction.workflow_node_attempts.findUnique).not.toHaveBeenCalled();
		expect(transaction.$executeRaw).not.toHaveBeenCalled();
		expect(persisted).toEqual({ status: "waiting_external", output_refs: JSON.stringify(changed) });
	});

	it.each([null, "prior-root"])("fences attempt identity even with base %s", async (baseRootHash) => {
		checkpointGuardRows = () => [];
		await expect(updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1",
			outputCheckpoint: { output: outputStorage.encodeWorkflowOutput({ taskId: "accepted" }), nodeRunId: "node-run-1", attempt: 1, baseRootHash },
		})).rejects.toMatchObject({ name: "WorkflowOutputCheckpointStaleError", reason: "attempt_changed" });
		expect(transaction.workflow_node_runs.update).not.toHaveBeenCalled();
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		expect(transaction.$executeRaw).not.toHaveBeenCalled();
	});

	it("allows null-base initialization only for the fenced active attempt", async () => {
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun());
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: '["accepted-before"]',
		});
		await updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1",
			outputCheckpoint: { output: outputStorage.encodeWorkflowOutput({ taskId: "accepted-now" }), nodeRunId: "node-run-1", attempt: 1, baseRootHash: null },
		});
		expect(transaction.$executeRaw.mock.calls[0]![0].values).toContain('["accepted-before","accepted-now"]');
	});

	it.each([
		JSON.stringify(outputStorage.encodeWorkflowOutput({ taskId: "accepted-current" })),
		'{"taskId":"accepted-current"}',
		"null",
		"",
	])("rejects a null-base first packet over any authoritative existing output %s", async (existing) => {
		const persisted = { status: "waiting_external", output_refs: existing };
		checkpointGuardOutput(existing);
		transaction.workflow_node_runs.update.mockImplementationOnce(async (input: { data: { status?: string } }) => {
			persisted.status = input.data.status ?? persisted.status;
			return nodeRun(persisted);
		});
		prismaMock.$transaction.mockImplementationOnce(async (operation) => {
			const before = { ...persisted };
			try { return await operation(transaction); }
			catch (error: unknown) { Object.assign(persisted, before); throw error; }
		});
		await expect(updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1", status: "success",
			outputCheckpoint: { output: outputStorage.encodeWorkflowOutput({ taskId: "stale-first-packet" }), nodeRunId: "node-run-1", attempt: 1, baseRootHash: null },
		})).rejects.toMatchObject({ name: "WorkflowOutputCheckpointStaleError", reason: "base_root_changed", code: "workflow_output_checkpoint_stale" });
		expect(persisted).toEqual({ status: "waiting_external", output_refs: existing });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		expect(transaction.workflow_node_runs.update).not.toHaveBeenCalled();
		expect(transaction.workflow_node_attempts.findUnique).not.toHaveBeenCalled();
		expect(transaction.$executeRaw).not.toHaveBeenCalled();
	});

	it("preserves the first accepted receipt when a second physical writer initializes the same attempt", async () => {
		const persisted: { status: string; output_refs: string | null } = { status: "pending", output_refs: null };
		checkpointGuardRows = () => [{ id: "node-run-1", attempt: 1, output_refs: persisted.output_refs }];
		const update = async (input: { data: { status?: string } }) => {
			persisted.status = input.data.status ?? persisted.status;
			return nodeRun(persisted);
		};
		const transact = async (operation: (client: typeof transaction) => Promise<unknown>) => {
			const before = { ...persisted };
			try { return await operation(transaction); }
			catch (error: unknown) { Object.assign(persisted, before); throw error; }
		};
		transaction.workflow_node_runs.update.mockImplementationOnce(update).mockImplementationOnce(update);
		prismaMock.$transaction.mockImplementationOnce(transact).mockImplementationOnce(transact);
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: null,
		});
		const actualPersist = outputStore.persistWorkflowOutput;
		const persist = vi.spyOn(outputStore, "persistWorkflowOutput").mockImplementationOnce(async (client, id, output) => {
			const result = await actualPersist(client, id, output);
			persisted.output_refs = JSON.stringify(output);
			return result;
		});
		try {
			const first = outputStorage.encodeWorkflowOutput({ taskId: "accepted-first-writer" });
			await updateNodeRun({} as never, {
				executionId: "execution-1", nodeId: "node-1", status: "waiting_external",
				outputCheckpoint: { output: first, nodeRunId: "node-run-1", attempt: 1, baseRootHash: null },
			});
			await expect(updateNodeRun({} as never, {
				executionId: "execution-1", nodeId: "node-1", status: "success",
				outputCheckpoint: { output: outputStorage.encodeWorkflowOutput({ taskId: "second-writer" }), nodeRunId: "node-run-1", attempt: 1, baseRootHash: null },
			})).rejects.toMatchObject({ name: "WorkflowOutputCheckpointStaleError", reason: "base_root_changed" });
			expect(persisted).toEqual({ status: "waiting_external", output_refs: JSON.stringify(first) });
			expect(persist).toHaveBeenCalledTimes(1);
			expect(transaction.$queryRaw).toHaveBeenCalledTimes(4);
			expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
			expect(transaction.$executeRaw.mock.calls[0]![0].values).toContain('["accepted-first-writer"]');
		} finally { persist.mockRestore(); }
	});

	it.each([{ id: "another-run", attempt: 1 }, { id: "node-run-1", attempt: 2 }])("rejects an inconsistent returned fence %j before output persistence", async (identity) => {
		checkpointGuardRows = () => [{ ...identity, output_refs: null }];
		await expect(updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1",
			outputCheckpoint: { output: outputStorage.encodeWorkflowOutput({ taskId: "accepted" }), nodeRunId: "node-run-1", attempt: 1, baseRootHash: null },
		})).rejects.toMatchObject({ name: "WorkflowOutputCheckpointStaleError", reason: "attempt_changed" });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		expect(transaction.workflow_node_runs.update).not.toHaveBeenCalled();
		expect(transaction.$executeRaw).not.toHaveBeenCalled();
	});

	it("validates prepared block integrity before opening a transaction", async () => {
		const output = outputStorage.encodeWorkflowOutput({ taskId: "accepted", body: "large".repeat(300) });
		await expect(updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1",
			outputCheckpoint: { output: { ...output, blocks: {} }, nodeRunId: "node-run-1", attempt: 1, baseRootHash: null },
		})).rejects.toThrow("Workflow output block missing");
		expect(prismaMock.$transaction).not.toHaveBeenCalled();
	});

	it("rejects a non-envelope base without silently cold encoding historical output", async () => {
		const output = outputStorage.encodeWorkflowOutput({ taskId: "accepted-next" });
		checkpointGuardOutput('{"taskId":"accepted-history"}');
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun({ output_refs: '{"taskId":"accepted-history"}' }));
		const encode = vi.spyOn(outputStorage, "encodeWorkflowOutput");
		try {
			await expect(updateNodeRun({} as never, {
				executionId: "execution-1", nodeId: "node-1",
				outputCheckpoint: { output, nodeRunId: "node-run-1", attempt: 1, baseRootHash: workflowOutputRootHash(output) },
			})).rejects.toMatchObject({ name: "WorkflowPersistenceError", recoverable: false });
			expect(encode).not.toHaveBeenCalled();
			expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
			expect(transaction.workflow_node_runs.update).not.toHaveBeenCalled();
			expect(transaction.$executeRaw).not.toHaveBeenCalled();
		} finally { encode.mockRestore(); }
	});

	it("rejects simultaneous ordinary and prepared output without opening a transaction", async () => {
		await expect(updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1", outputRefs: { taskId: "ordinary" },
			outputCheckpoint: { output: outputStorage.encodeWorkflowOutput({ taskId: "prepared" }), nodeRunId: "node-run-1", attempt: 1, baseRootHash: null },
		} as never)).rejects.toThrow("mutually exclusive");
		expect(prismaMock.$transaction).not.toHaveBeenCalled();
	});

	it("rejects applying one attempt fence to an aggregate lifecycle update before the first write", async () => {
		await expect(updateNodeRuns({} as never, {
			executionId: "execution-1", nodeIds: ["node-1", "node-2"],
			update: { outputCheckpoint: { output: outputStorage.encodeWorkflowOutput({ taskId: "accepted" }), nodeRunId: "node-run-1", attempt: 1, baseRootHash: null } },
		} as never)).rejects.toThrow("must target one node-run identity");
		expect(prismaMock.$transaction).not.toHaveBeenCalled();
		expect(transaction.workflow_node_runs.update).not.toHaveBeenCalled();
	});

	it("reports an unknown commit and refuses old-base replay after the accepted receipt was committed", async () => {
		const base = outputStorage.encodeWorkflowOutput({ taskId: "accepted-before" });
		const output = outputStorage.patchWorkflowOutput(base, [{ kind: "add", path: ["result"], value: { taskId: "accepted-after" } }]).output;
		const checkpoint = { output, nodeRunId: "node-run-1", attempt: 1, baseRootHash: workflowOutputRootHash(base) };
		checkpointGuardOutput(JSON.stringify(base));
		transaction.workflow_node_runs.update.mockResolvedValueOnce(nodeRun({ output_refs: JSON.stringify(base) }))
			.mockResolvedValue(nodeRun({ output_refs: JSON.stringify(output) }));
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(paidSemantics), provider_receipts: '["accepted-before"]',
		});
		const lostCommitReceipt = Object.assign(new Error("commit result unavailable"), { code: "P2028" });
		prismaMock.$transaction.mockImplementationOnce(async (operation) => {
			await operation(transaction);
			throw lostCommitReceipt;
		});
		await expect(updateNodeRun({} as never, { executionId: "execution-1", nodeId: "node-1", outputCheckpoint: checkpoint }))
			.rejects.toMatchObject({ name: "WorkflowPersistenceError", cause: lostCommitReceipt, recoverable: true });
		expect(transaction.$executeRaw.mock.calls[0]![0].values).toContain('["accepted-before","accepted-after"]');
		const persistedOutputQueries = transaction.$queryRaw.mock.calls.length;
		checkpointGuardOutput(JSON.stringify(output));
		await expect(updateNodeRun({} as never, { executionId: "execution-1", nodeId: "node-1", outputCheckpoint: checkpoint }))
			.rejects.toMatchObject({ name: "WorkflowOutputCheckpointStaleError", reason: "base_root_changed" });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(persistedOutputQueries + 1);
		expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
	});
});
