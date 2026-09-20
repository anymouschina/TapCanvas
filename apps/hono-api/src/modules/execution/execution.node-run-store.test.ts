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

const transaction = {
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
	$transaction: vi.fn(async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction)),
};

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prismaMock }));

import { ensureNodeRuns, incrementNodeRunAttempt, updateNodeRun } from "./execution.node-run-store";

beforeEach(() => {
	vi.clearAllMocks();
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

		expect(transaction.workflow_node_attempts.update).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({
				status: "waiting_external",
				provider_receipts: JSON.stringify(["provider-old", "provider-new"]),
			}),
		}));
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
		expect(transaction.workflow_node_attempts.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
			status: "success", output_refs: serialized,
			provider_receipts: JSON.stringify(["provider-old", ...output.itemRuns.map((item) => item.evidence.taskId)]),
		}) }));
	});

	it("reports the failed persistence phase without exposing output and rethrows the original error", async () => {
		const failure = Object.assign(new Error("transaction expired"), { code: "P2028" });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		transaction.workflow_node_runs.update.mockResolvedValue(nodeRun());
		transaction.workflow_node_attempts.findUnique.mockResolvedValue({
			semantics_snapshot: JSON.stringify(replaySemantics), provider_receipts: null,
		});
		transaction.workflow_node_attempts.update.mockRejectedValueOnce(failure);
		try {
			await expect(updateNodeRun({} as never, {
				executionId: "execution-1", nodeId: "node-1", outputRefs: { privateText: "不得记录" },
			})).rejects.toBe(failure);
			const diagnostic = JSON.parse(warn.mock.calls[0]![0] as string) as Record<string, unknown>;
			expect(diagnostic).toMatchObject({
				message: "workflow_node_persistence_timing", outcome: "failed",
				lastPhase: "update_attempt", errorCodes: ["P2028"],
			});
			expect(JSON.stringify(diagnostic)).not.toContain("不得记录");
			expect(transaction.workflow_node_attempts.update).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
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
  expect(transaction.workflow_node_attempts.update).toHaveBeenCalledWith({
    where: { node_run_id_attempt: { node_run_id: 'node-run-1', attempt: 1 } }, data: { status: 'running' }, select: { id: true },
  });
});
