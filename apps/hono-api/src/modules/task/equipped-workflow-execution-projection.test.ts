import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import type { WorkflowExecutionDto } from "../execution/execution.schemas";

const mocks = vi.hoisted(() => ({
	findFlowNode: vi.fn(),
	freshReadFlowRow: vi.fn(),
	persistFlowPatch: vi.fn(),
	readFlowNodes: vi.fn(),
}));

vi.mock("./video-orchestrator.flow-io", () => ({
	findFlowNode: mocks.findFlowNode,
	freshReadFlowRow: mocks.freshReadFlowRow,
	persistFlowPatch: mocks.persistFlowPatch,
	readFlowNodes: mocks.readFlowNodes,
}));

import { upsertEquippedWorkflowExecutionProjection } from "./equipped-workflow-execution-projection";

const context = {} as AppContext;
const row = {
	id: "flow-1",
	name: "Flow",
	owner_id: "user-1",
	project_id: "project-1",
	data: JSON.stringify({ nodes: [], edges: [] }),
	created_at: "2026-08-23T00:00:00.000Z",
	updated_at: "2026-08-23T00:00:00.000Z",
};
const execution = {
	id: "execution-1",
	flowId: "workflow-flow-1",
	flowVersionId: "version-1",
	ownerId: "user-1",
	status: "queued",
	concurrency: 1,
	executionFamilyId: "execution-1",
	createdAt: "2026-08-23T01:00:00.000Z",
} satisfies WorkflowExecutionDto;

describe("upsertEquippedWorkflowExecutionProjection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.freshReadFlowRow.mockResolvedValue(row);
		mocks.findFlowNode.mockReturnValue(null);
		mocks.readFlowNodes.mockReturnValue([]);
		mocks.persistFlowPatch.mockResolvedValue({ row });
	});

	it("persists the singleton execution node on an empty caller canvas", async () => {
		await expect(upsertEquippedWorkflowExecutionProjection({
			c: context,
			ownerId: "user-1",
			flowId: "flow-1",
			execution,
		})).resolves.toEqual({ status: "created" });

		expect(mocks.persistFlowPatch).toHaveBeenCalledWith(expect.objectContaining({
			affectedNodeIds: ["workflow-execution-status"],
			patch: {
				createNodes: [expect.objectContaining({
					id: "workflow-execution-status",
					type: "workflowExecutionNode",
					position: { x: 0, y: 0 },
					data: expect.objectContaining({
						managedProjection: "workflow_execution",
						workflowRuntimeReference: false,
						workflowExecutionId: "execution-1",
						workflowExecutionFamilyId: "execution-1",
						workflowRootExecutionId: "execution-1",
						workflowLatestExecutionId: "execution-1",
						workflowRecoveryCount: 0,
						workflowStatus: "queued",
					}),
				})],
			},
		}));
	});

	it("projects the newest physical recovery as one logical execution family", async () => {
		mocks.findFlowNode.mockReturnValue({
			id: "workflow-execution-status",
			type: "workflowExecutionNode",
			data: {
				kind: "workflowExecution",
				managedProjection: "workflow_execution",
				workflowRuntimeReference: false,
				workflowExecutionId: "execution-root",
				workflowExecutionFamilyId: "execution-root",
				workflowExecutionCreatedAt: "2026-08-23T00:30:00.000Z",
				workflowRecoveryCount: 0,
			},
		});
		const recoveryExecution: WorkflowExecutionDto = {
			...execution,
			id: "execution-recovery-2",
			status: "running",
			executionFamilyId: "execution-root",
			recoveryOfExecutionId: "execution-recovery-1",
			createdAt: "2026-08-23T01:30:00.000Z",
			nodeSummary: {
				total: 19,
				queued: 10,
				running: 1,
				waitingExternal: 0,
				success: 8,
				failed: 0,
				canceled: 0,
				skipped: 0,
				notSelected: 0,
			},
		};

		await expect(upsertEquippedWorkflowExecutionProjection({
			c: context,
			ownerId: "user-1",
			flowId: "flow-1",
			execution: recoveryExecution,
			family: {
				executionFamilyId: "execution-root",
				rootExecutionId: "execution-root",
				latestExecutionId: "execution-recovery-2",
				executionCount: 3,
				updatedAt: "2026-08-23T01:31:00.000Z",
			},
		})).resolves.toEqual({ status: "updated" });

		expect(mocks.persistFlowPatch).toHaveBeenCalledWith(expect.objectContaining({
			patch: expect.objectContaining({
				patchNodeData: [expect.objectContaining({
					data: expect.objectContaining({
						workflowExecutionId: "execution-recovery-2",
						workflowExecutionFamilyId: "execution-root",
						workflowRootExecutionId: "execution-root",
						workflowLatestExecutionId: "execution-recovery-2",
						workflowRecoveryCount: 2,
						workflowStatus: "running",
						workflowCompletedUnits: 8,
						workflowTotalUnits: 19,
					}),
				})],
			}),
		}));
	});

	it("updates the same node for a newer accepted execution", async () => {
		mocks.findFlowNode.mockReturnValue({
			id: "workflow-execution-status",
			type: "workflowExecutionNode",
			data: {
				kind: "workflowExecution",
				managedProjection: "workflow_execution",
				workflowRuntimeReference: false,
				workflowExecutionId: "execution-old",
				workflowExecutionCreatedAt: "2026-08-23T00:30:00.000Z",
			},
		});

		await expect(upsertEquippedWorkflowExecutionProjection({
			c: context,
			ownerId: "user-1",
			flowId: "flow-1",
			execution,
		})).resolves.toEqual({ status: "updated" });
		expect(mocks.persistFlowPatch).toHaveBeenCalledWith(expect.objectContaining({
			patch: expect.objectContaining({ allowOverwrite: true }),
		}));
	});

	it("does not let a late older admission regress the visible execution", async () => {
		mocks.findFlowNode.mockReturnValue({
			id: "workflow-execution-status",
			type: "workflowExecutionNode",
			data: {
				kind: "workflowExecution",
				managedProjection: "workflow_execution",
				workflowRuntimeReference: false,
				workflowExecutionId: "execution-new",
				workflowExecutionCreatedAt: "2026-08-23T02:00:00.000Z",
			},
		});

		await expect(upsertEquippedWorkflowExecutionProjection({
			c: context,
			ownerId: "user-1",
			flowId: "flow-1",
			execution,
		})).resolves.toEqual({ status: "ignored_stale", currentExecutionId: "execution-new" });
		expect(mocks.persistFlowPatch).not.toHaveBeenCalled();
	});

	it("fails explicitly instead of overwriting user data at the reserved node id", async () => {
		mocks.findFlowNode.mockReturnValue({
			id: "workflow-execution-status",
			type: "taskNode",
			data: { kind: "text", content: "user data" },
		});

		await expect(upsertEquippedWorkflowExecutionProjection({
			c: context,
			ownerId: "user-1",
			flowId: "flow-1",
			execution,
		})).rejects.toMatchObject({ code: "workflow_execution_projection_id_conflict" });
		expect(mocks.persistFlowPatch).not.toHaveBeenCalled();
	});
});
