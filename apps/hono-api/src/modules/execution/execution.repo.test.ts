import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
	$transaction: vi.fn(),
	workflow_executions: { create: vi.fn(), findMany: vi.fn() },
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prismaMock,
}));

import { createExecution, getWorkflowExecutionMetricsForOwner, insertExecutionEvent, listExecutionHistoryForOwnerFlow, listExecutionHistoryPageForOwner, mapExecutionRow, mapNodeRunHistoryRow } from "./execution.repo";

const transactionClient = {
	$queryRawUnsafe: vi.fn(),
	workflow_executions: {
		create: vi.fn(),
	},
	workflow_execution_events: {
		findFirst: vi.fn(),
		create: vi.fn(),
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	prismaMock.$transaction.mockImplementation(async (
		operation: (client: typeof transactionClient) => Promise<unknown>,
	) => operation(transactionClient));
});

describe("execution node run history mapping", () => {
	it("exposes frozen asset snapshot and standardized failure diagnostics", () => {
		const mapped = mapExecutionRow({
			id: "execution-1", flow_id: "flow-1", flow_version_id: "version-1", owner_id: "user-1",
			status: "failed", concurrency: 1, trigger: "agent", error_message: "asset missing",
			error_code: "workflow_asset_not_found", failure_stage: "asset_access",
			project_id: "project-1", canvas_id: "canvas-1", user_input: "make a film",
			project_context: JSON.stringify({ version: 1, projectId: "project-1" }),
			asset_snapshot: JSON.stringify([{ assetId: "asset-1", state: "ready" }]),
			retry_count: 2, recovery_of_execution_id: null, uses_project_assets: true,
			execution_family_id: "execution-1",
			created_at: "2026-08-17T00:00:00.000Z", started_at: "2026-08-17T00:00:01.000Z", finished_at: "2026-08-17T00:00:03.000Z",
		});
		expect(mapped).toMatchObject({
			workflowVersion: "version-1",
			assetSnapshot: [{ assetId: "asset-1", state: "ready" }],
			errorCode: "workflow_asset_not_found",
			failureStage: "asset_access",
			durationMs: 2_000,
			retryCount: 2,
		});
	});

	it("includes the workflow name when the global history query joins it", () => {
		const mapped = mapExecutionRow({
			id: "execution-1", flow_id: "flow-1", flow_version_id: "version-1", owner_id: "user-1",
			status: "success", concurrency: 1, trigger: "manual", error_message: null,
			execution_family_id: "execution-1",
			created_at: "2026-08-20T00:00:00.000Z", started_at: null, finished_at: null,
			flows: { name: "跨项目工作流" },
		});
		expect(mapped.flowName).toBe("跨项目工作流");
	});

	it("returns persisted item outputs together with parent execution facts", () => {
		const mapped = mapNodeRunHistoryRow({
			id: "node-run-1",
			execution_id: "execution-1",
			node_id: "video-node",
			status: "success",
			attempt: 1,
			error_message: null,
			output_refs: JSON.stringify({
				itemRuns: [
					{ itemId: "segment-1", status: "success" },
					{ itemId: "segment-2", status: "success" },
				],
			}),
			created_at: "2026-08-11T08:00:01.000Z",
			started_at: "2026-08-11T08:00:02.000Z",
			finished_at: "2026-08-11T08:01:00.000Z",
			workflow_executions: {
				status: "success",
				created_at: "2026-08-11T08:00:00.000Z",
				finished_at: "2026-08-11T08:01:01.000Z",
			},
		});

		expect(mapped).toMatchObject({
			executionId: "execution-1",
			nodeId: "video-node",
			status: "success",
			executionStatus: "success",
			executionCreatedAt: "2026-08-11T08:00:00.000Z",
		});
		expect(mapped.outputRefs).toEqual({
			itemRuns: [
				{ itemId: "segment-1", status: "success" },
				{ itemId: "segment-2", status: "success" },
			],
		});
	});
});

describe("workflow execution event journal", () => {
	it("allocates the next sequence while holding the parent execution row lock", async () => {
		transactionClient.$queryRawUnsafe.mockResolvedValue([{ id: "execution-1" }]);
		transactionClient.workflow_execution_events.findFirst.mockResolvedValue({ seq: 7 });
		transactionClient.workflow_execution_events.create.mockResolvedValue({ id: "event-8" });

		const seq = await insertExecutionEvent({} as never, {
			id: "event-8",
			executionId: "execution-1",
			eventType: "node_progress",
			nodeId: "node-1",
			data: { progress: 0.5 },
			nowIso: "2026-08-14T05:30:00.000Z",
		});

		expect(seq).toBe(8);
		expect(transactionClient.$queryRawUnsafe).toHaveBeenCalledWith(
			expect.stringContaining("FOR UPDATE"),
			"execution-1",
		);
		expect(transactionClient.workflow_execution_events.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				id: "event-8",
				execution_id: "execution-1",
				seq: 8,
				event_type: "node_progress",
			}),
		});
	});

	it("fails explicitly when the parent execution no longer exists", async () => {
		transactionClient.$queryRawUnsafe.mockResolvedValue([]);

		await expect(insertExecutionEvent({} as never, {
			id: "event-orphan",
			executionId: "missing-execution",
			eventType: "node_progress",
			nowIso: "2026-08-14T05:31:00.000Z",
		})).rejects.toThrow(/workflow execution not found/u);
		expect(transactionClient.workflow_execution_events.create).not.toHaveBeenCalled();
	});
});

describe("workflow recovery admission", () => {
	const recoveryInput = {
		id: "execution-recovery",
		flowId: "flow-1",
		flowVersionId: "version-recovery",
		ownerId: "user-1",
		concurrency: 8,
		trigger: "agent",
		recoveryOfExecutionId: "execution-source",
		recoveryAdmission: "failed_source" as const,
		executionFamilyId: "execution-family",
		nowIso: "2026-08-29T03:16:05.000Z",
	};

	it("locks and rechecks the source immediately before inserting a recovery child", async () => {
		transactionClient.$queryRawUnsafe.mockResolvedValue([{
			id: "execution-source",
			owner_id: "user-1",
			status: "failed",
			execution_family_id: "execution-family",
		}]);
		transactionClient.workflow_execution_events.findFirst.mockResolvedValue(null);

		await createExecution({} as never, recoveryInput);

		expect(transactionClient.$queryRawUnsafe).toHaveBeenCalledWith(
			expect.stringContaining("FOR UPDATE"),
			"execution-source",
		);
		expect(transactionClient.workflow_executions.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				id: "execution-recovery",
				recovery_of_execution_id: "execution-source",
				execution_family_id: "execution-family",
			}),
		});
	});

	it("rejects a recovery whose source was canceled while preparation was in flight", async () => {
		transactionClient.$queryRawUnsafe.mockResolvedValue([{
			id: "execution-source",
			owner_id: "user-1",
			status: "canceled",
			execution_family_id: "execution-family",
		}]);

		await expect(createExecution({} as never, recoveryInput)).rejects.toMatchObject({
			name: "WorkflowRecoveryAdmissionError",
			reason: "recovery_source_status_changed",
		});
		expect(transactionClient.workflow_executions.create).not.toHaveBeenCalled();
	});

	it("requires explicit cancellation revocation to cross a family cancellation fence", async () => {
		transactionClient.$queryRawUnsafe.mockResolvedValue([{
			id: "execution-source",
			owner_id: "user-1",
			status: "failed",
			execution_family_id: "execution-family",
		}]);
		transactionClient.workflow_execution_events.findFirst.mockResolvedValue({ id: "event-canceled" });

		await expect(createExecution({} as never, recoveryInput)).rejects.toMatchObject({
			name: "WorkflowRecoveryAdmissionError",
			reason: "recovery_family_canceled",
		});
		expect(transactionClient.workflow_executions.create).not.toHaveBeenCalled();
	});
});

describe("workflow execution metrics", () => {
	it("compares project-asset runs and exposes recovery/node dimensions", async () => {
		prismaMock.workflow_executions.findMany.mockResolvedValue([
			{ id: "run-1", status: "success", flow_version_id: "v1", uses_project_assets: true, recovery_of_execution_id: null, workflow_node_runs: [{ status: "success", node_type: "source", tool_name: null, model_key: null }] },
			{ id: "run-2", status: "failed", flow_version_id: "v1", uses_project_assets: false, recovery_of_execution_id: null, workflow_node_runs: [{ status: "failed", node_type: "agent", tool_name: "search", model_key: "model-a" }] },
			{ id: "run-3", status: "success", flow_version_id: "v1", uses_project_assets: true, recovery_of_execution_id: "run-2", workflow_node_runs: [{ status: "success", node_type: "agent", tool_name: "search", model_key: "model-a" }] },
		]);
		const metrics = await getWorkflowExecutionMetricsForOwner({} as never, { ownerId: "user-1", flowId: "flow-1" });
		expect(prismaMock.workflow_executions.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				owner_id: "user-1",
				OR: [{ flow_id: "flow-1" }, { canvas_id: "flow-1" }],
			},
		}));
		expect(metrics).toMatchObject({
			sampleSize: 3,
			workflowSuccessRate: 0.6667,
			nodeFailureRate: 0.3333,
			recoverySuccessRate: 1,
			breakdowns: {
				projectAssetUsage: expect.arrayContaining([
					expect.objectContaining({ key: "uses_project_assets", total: 2, successRate: 1 }),
					expect.objectContaining({ key: "no_project_assets", total: 1, successRate: 0 }),
				]),
			},
		});
	});
});

describe("equipped workflow execution history projection", () => {
	it("pages all executions for the authenticated owner when no flow filter is provided", async () => {
		prismaMock.workflow_executions.findMany.mockResolvedValue([
			{ id: "run-3" },
			{ id: "run-2" },
			{ id: "run-1" },
		]);

		const page = await listExecutionHistoryPageForOwner({} as never, {
			ownerId: "user-1",
			limit: 2,
			cursor: "run-4",
		});

		expect(prismaMock.workflow_executions.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { owner_id: "user-1" },
			cursor: { id: "run-4" },
			skip: 1,
			take: 3,
			include: expect.objectContaining({ flows: { select: { name: true } } }),
		}));
		expect(page.items.map((item) => item.id)).toEqual(["run-3", "run-2"]);
		expect(page.nextCursor).toBe("run-2");
	});

	it("lists source-flow runs and runs delivered to the current canvas", async () => {
		prismaMock.workflow_executions.findMany.mockResolvedValue([]);

		await listExecutionHistoryForOwnerFlow({} as never, {
			ownerId: "user-1",
			flowId: "caller-canvas-1",
			limit: 40,
		});

		expect(prismaMock.workflow_executions.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				owner_id: "user-1",
				OR: [{ flow_id: "caller-canvas-1" }, { canvas_id: "caller-canvas-1" }],
			},
		}));
	});

	it("can query only queued and running executions without scanning terminal history", async () => {
		prismaMock.workflow_executions.findMany.mockResolvedValue([]);

		await listExecutionHistoryForOwnerFlow({} as never, {
			ownerId: "user-1",
			flowId: "workflow-definition-1",
			limit: 1,
			activeOnly: true,
		});

		expect(prismaMock.workflow_executions.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				owner_id: "user-1",
				OR: [{ flow_id: "workflow-definition-1" }, { canvas_id: "workflow-definition-1" }],
				status: { in: ["queued", "running"] },
			},
			take: 1,
		}));
	});
});
