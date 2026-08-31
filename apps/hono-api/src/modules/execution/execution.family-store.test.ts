import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION } from "@tapcanvas/workflow-kernel-protocol";
import {
	getWorkflowExecutionFamilyPageForOwner,
	listWorkflowNodeAttemptsPageForExecutionOwner,
	mapWorkflowNodeAttemptRow,
	type WorkflowNodeAttemptRow,
} from "./execution.family-store";

const prisma = vi.hoisted(() => ({
	workflow_node_attempts: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		count: vi.fn(),
	},
	workflow_executions: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		count: vi.fn(),
		aggregate: vi.fn(),
	},
}));

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prisma }));

const semanticsSnapshot = JSON.stringify({
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
});

function attemptRow(id: string, createdAt: string): WorkflowNodeAttemptRow {
	return {
		id,
		execution_family_id: "execution-root",
		execution_id: "execution-recovery",
		node_run_id: `node-run-${id}`,
		node_id: "image-1",
		attempt: 2,
		trigger: "runtime_recovery",
		status: "waiting_external",
		semantics_snapshot: semanticsSnapshot,
		input_refs: null,
		output_refs: null,
		tool_calls: null,
		provider_receipts: null,
		token_usage: null,
		credit_usage: null,
		error_message: null,
		error_code: null,
		failure_stage: "media_generation",
		node_type: "tapcanvas.image.generate/v1",
		tool_name: null,
		model_key: "gpt-image-2",
		created_at: createdAt,
		started_at: null,
		finished_at: null,
	};
}

function executionRow(id: string, input: {
	status: string;
	createdAt: string;
	startedAt?: string | null;
	finishedAt?: string | null;
}) {
	return {
		id,
		flow_id: "flow-1",
		flow_version_id: "flow-version-1",
		owner_id: "owner-1",
		status: input.status,
		concurrency: 1,
		trigger: "agent",
		error_message: null,
		error_code: null,
		failure_stage: null,
		project_id: "project-1",
		canvas_id: "canvas-1",
		user_input: "large user input must not enter a family page",
		project_context: JSON.stringify({ payload: "x".repeat(10_000) }),
		asset_snapshot: JSON.stringify([{ payload: "x".repeat(10_000) }]),
		retry_count: 0,
		recovery_of_execution_id: id === "execution-root" ? null : "execution-root",
		execution_family_id: "execution-root",
		uses_project_assets: false,
		created_at: input.createdAt,
		started_at: input.startedAt ?? null,
		finished_at: input.finishedAt ?? null,
		flows: { name: "Workflow" },
	};
}

describe("workflow execution family projection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("exposes frozen semantics, receipts and immutable attempt identity", () => {
		const mapped = mapWorkflowNodeAttemptRow({
			id: "attempt-row-2",
			execution_family_id: "execution-root",
			execution_id: "execution-recovery",
			node_run_id: "node-run-1",
			node_id: "image-1",
			attempt: 2,
			trigger: "runtime_recovery",
			status: "waiting_external",
			semantics_snapshot: JSON.stringify({
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
			}),
			input_refs: JSON.stringify({ prompt: ["scene"] }),
			output_refs: JSON.stringify({ evidence: { taskId: "provider-1" } }),
			tool_calls: null,
			provider_receipts: JSON.stringify(["provider-1"]),
			token_usage: null,
			credit_usage: JSON.stringify({ reserved: 20 }),
			error_message: null,
			error_code: null,
			failure_stage: "media_generation",
			node_type: "tapcanvas.image.generate/v1",
			tool_name: null,
			model_key: "gpt-image-2",
			created_at: "2026-08-20T01:00:00.000Z",
			started_at: "2026-08-20T01:00:01.000Z",
			finished_at: null,
		});

		expect(mapped).toMatchObject({
			executionFamilyId: "execution-root",
			executionId: "execution-recovery",
			attempt: 2,
			trigger: "runtime_recovery",
			providerReceipts: ["provider-1"],
			creditUsage: { reserved: 20 },
			semanticsSnapshot: { recoveryMode: "reconcile" },
		});
	});

	it("paginates immutable attempts with a stable exclusive cursor", async () => {
		prisma.workflow_node_attempts.findFirst.mockResolvedValue({ id: "attempt-previous" });
		prisma.workflow_node_attempts.findMany.mockResolvedValue([
			attemptRow("attempt-1", "2026-08-20T01:00:00.000Z"),
			attemptRow("attempt-2", "2026-08-20T01:01:00.000Z"),
			attemptRow("attempt-3", "2026-08-20T01:02:00.000Z"),
		]);

		const page = await listWorkflowNodeAttemptsPageForExecutionOwner({} as never, {
			ownerId: "owner-1",
			executionId: "execution-recovery",
			cursor: "attempt-previous",
			limit: 2,
		});

		expect(page.items.map((item) => item.id)).toEqual(["attempt-1", "attempt-2"]);
		expect(page.nextCursor).toBe("attempt-2");
		expect(prisma.workflow_node_attempts.findMany).toHaveBeenCalledWith(expect.objectContaining({
			cursor: { id: "attempt-previous" },
			skip: 1,
			take: 3,
			orderBy: [{ created_at: "asc" }, { id: "asc" }],
		}));
	});

	it("rejects a cursor that is not owned by the execution scope", async () => {
		prisma.workflow_node_attempts.findFirst.mockResolvedValue(null);

		await expect(listWorkflowNodeAttemptsPageForExecutionOwner({} as never, {
			ownerId: "owner-1",
			executionId: "execution-recovery",
			cursor: "foreign-attempt",
		})).rejects.toThrow("workflow_node_attempt_cursor_invalid");
		expect(prisma.workflow_node_attempts.findMany).not.toHaveBeenCalled();
	});

	it("paginates an execution family while computing complete bounded aggregate facts", async () => {
		const root = executionRow("execution-root", {
			status: "failed",
			createdAt: "2026-08-20T00:00:00.000Z",
			startedAt: "2026-08-20T00:00:01.000Z",
			finishedAt: "2026-08-20T00:10:00.000Z",
		});
		const recovery = executionRow("execution-recovery", {
			status: "running",
			createdAt: "2026-08-20T00:11:00.000Z",
			startedAt: "2026-08-20T00:11:01.000Z",
		});
		const next = executionRow("execution-next", {
			status: "queued",
			createdAt: "2026-08-20T00:12:00.000Z",
		});
		prisma.workflow_executions.findFirst
			.mockResolvedValueOnce({ execution_family_id: "execution-root" })
			.mockResolvedValueOnce(root)
			.mockResolvedValueOnce(next);
		prisma.workflow_executions.findMany
			.mockResolvedValueOnce([root, recovery, next])
			.mockResolvedValueOnce([{ id: "execution-recovery" }, { id: "execution-next" }]);
		prisma.workflow_executions.count
			.mockResolvedValueOnce(2)
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(0);
		prisma.workflow_node_attempts.count.mockResolvedValue(7);
		prisma.workflow_executions.aggregate.mockResolvedValue({
			_max: {
				created_at: "2026-08-20T00:12:00.000Z",
				started_at: "2026-08-20T00:11:01.000Z",
				finished_at: "2026-08-20T00:13:00.000Z",
			},
		});

		const page = await getWorkflowExecutionFamilyPageForOwner({} as never, {
			ownerId: "owner-1",
			executionId: "execution-recovery",
			limit: 2,
		});

		expect(page).toMatchObject({
			executionFamilyId: "execution-root",
			latestExecutionId: "execution-next",
			latestExecutionStatus: "queued",
			activeExecutionIds: ["execution-recovery", "execution-next"],
			activeExecutionCount: 2,
			activeExecutionIdsTruncated: false,
			executionCount: 3,
			successfulExecutionCount: 0,
			nodeAttemptCount: 7,
			updatedAt: "2026-08-20T00:13:00.000Z",
			nextCursor: "execution-recovery",
		});
		expect(page?.executions.map((execution) => execution.id)).toEqual([
			"execution-root",
			"execution-recovery",
		]);
		expect(page?.executions[0]).not.toHaveProperty("userInput");
		expect(page?.executions[0]).not.toHaveProperty("projectContext");
		expect(page?.executions[0]).not.toHaveProperty("assetSnapshot");
		expect(prisma.workflow_executions.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
			select: expect.not.objectContaining({
				user_input: true,
				project_context: true,
				asset_snapshot: true,
			}),
		}));
		expect(prisma.workflow_executions.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
			take: 200,
		}));
	});
});
