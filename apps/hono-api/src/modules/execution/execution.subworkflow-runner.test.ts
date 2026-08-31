import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import { startWorkflowExecution } from "./execution.start-service";
import { runWorkflowSubworkflow } from "./execution.subworkflow-runner";

vi.mock("./execution.start-service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./execution.start-service")>();
	return { ...actual, startWorkflowExecution: vi.fn() };
});

describe("workflow subworkflow runner", () => {
	beforeEach(() => {
		vi.mocked(startWorkflowExecution).mockReset();
	});

	it("rejects a pinned version cycle before reading or starting the target", async () => {
		const findFirst = vi.fn();
		const env = {
			DB: {
				flows: { findFirst },
				flow_versions: { findFirst: vi.fn() },
				workflow_executions: { findFirst: vi.fn() },
				workflow_node_runs: { findMany: vi.fn() },
			},
			JWT_SECRET: "test",
		} as unknown as WorkerEnv;
		const result = await runWorkflowSubworkflow(env, {
			parentExecutionId: "parent-execution",
			parentNodeId: "subworkflow",
			parentFlowVersionId: "parent-runtime-version",
			ancestry: ["target-pinned-version"],
			ownerId: "owner-1",
			targetFlowId: "flow-child",
			targetFlowVersionId: "target-pinned-version",
			triggerNodeId: "trigger-child",
			input: null,
			childExecutionId: null,
		});
		expect(result).toEqual({ status: "failed", childExecutionId: null, errorMessage: "Subworkflow version cycle detected at target-pinned-version" });
		expect(findFirst).not.toHaveBeenCalled();
	});

	it("starts the exact pinned version and propagates immutable ancestry", async () => {
		vi.mocked(startWorkflowExecution).mockResolvedValueOnce({
			created: true,
				execution: {
					id: "child-execution",
					executionFamilyId: "child-execution",
					flowId: "flow-child",
				flowVersionId: "child-runtime-version",
				ownerId: "owner-1",
				status: "queued",
				concurrency: 1,
				trigger: "subworkflow",
				createdAt: "2026-08-13T00:00:00.000Z",
				startedAt: null,
				finishedAt: null,
			},
		});
		const env = {
			DB: {
				flows: { findFirst: vi.fn(async () => ({
					id: "flow-child",
					name: "Mutable current name",
					data: "{\"mutable\":true}",
					owner_id: "owner-1",
					project_id: "project-1",
					created_at: "2026-08-12T00:00:00.000Z",
					updated_at: "2026-08-13T00:00:00.000Z",
					canvas_revision: 9,
				})) },
				flow_versions: { findFirst: vi.fn(async () => ({
					id: "target-pinned-version",
					name: "Pinned name",
					data: "{\"pinned\":true}",
					created_at: "2026-08-12T12:00:00.000Z",
				})) },
				workflow_executions: { findFirst: vi.fn() },
				workflow_node_runs: { findMany: vi.fn() },
			},
			JWT_SECRET: "test",
		} as unknown as WorkerEnv;
		const result = await runWorkflowSubworkflow(env, {
			parentExecutionId: "parent-execution",
			parentNodeId: "subworkflow-node",
			parentFlowVersionId: "parent-runtime-version",
			ancestry: ["root-version"],
			ownerId: "owner-1",
			targetFlowId: "flow-child",
			targetFlowVersionId: "target-pinned-version",
			triggerNodeId: "trigger-child",
			input: { itemId: "item-1" },
			childExecutionId: null,
		});
		expect(result).toEqual({ status: "waiting_external", childExecutionId: "child-execution", childFlowVersionId: "child-runtime-version" });
		expect(startWorkflowExecution).toHaveBeenCalledWith(env, expect.objectContaining({
			flow: expect.objectContaining({ name: "Pinned name", data: "{\"pinned\":true}", updated_at: "2026-08-12T12:00:00.000Z" }),
			workflowAncestry: ["root-version", "parent-runtime-version", "target-pinned-version"],
			idempotencyKey: "subworkflow:parent-execution:subworkflow-node:target-pinned-version",
			triggerPayload: expect.objectContaining({ input: { itemId: "item-1" } }),
		}));
	});

	it("resumes a persisted child and returns its terminal node evidence", async () => {
		const env = {
			DB: {
				flows: { findFirst: vi.fn() },
				flow_versions: { findFirst: vi.fn() },
				workflow_executions: { findFirst: vi.fn(async () => ({
					id: "child-execution",
					status: "success",
					flow_version_id: "child-runtime-version",
					error_message: null,
				})) },
				workflow_node_runs: { findMany: vi.fn(async () => [{
					node_id: "child-output",
					status: "success",
					output_refs: JSON.stringify({ version: 1, outputs: { result: { assetId: "asset-1" } } }),
				}]) },
			},
			JWT_SECRET: "test",
		} as unknown as WorkerEnv;
		const result = await runWorkflowSubworkflow(env, {
			parentExecutionId: "parent-execution",
			parentNodeId: "subworkflow-node",
			parentFlowVersionId: "parent-runtime-version",
			ancestry: [],
			ownerId: "owner-1",
			targetFlowId: "flow-child",
			targetFlowVersionId: "target-pinned-version",
			triggerNodeId: "trigger-child",
			input: null,
			childExecutionId: "child-execution",
		});
		expect(result).toEqual({
			status: "success",
			childExecutionId: "child-execution",
			childFlowVersionId: "child-runtime-version",
			nodeRuns: [{ nodeId: "child-output", status: "success", outputRefs: { version: 1, outputs: { result: { assetId: "asset-1" } } } }],
		});
		expect(startWorkflowExecution).not.toHaveBeenCalled();
	});
});
