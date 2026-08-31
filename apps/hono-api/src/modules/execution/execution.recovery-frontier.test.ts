import { describe, expect, it } from "vitest";
import {
	createWorkflowArtifactContract,
	createWorkflowInputContractRejection,
	WorkflowInputContractError,
} from "./execution.input-contract";
import { resolveWorkflowRecoveryFrontier } from "./execution.recovery-frontier";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";
import type { NodeRunRow } from "./execution.repo";

function graphNode(id: string, executorRef: string) {
	return {
		id,
		type: "taskNode",
		kind: "workflowStage",
		data: {
			workflowAtomicSpec: {
				version: 1,
				category: "control",
				operation: "test",
				executorRef,
				executionMode: "once",
				inputPorts: [],
				outputPorts: ["result"],
			},
		},
	};
}

function output(input: Readonly<{
	nodeId: string;
	executorRef: string;
	evidence?: Record<string, unknown>;
}>): WorkflowNodeOutputV1 {
	return {
		protocolVersion: "1",
		executorRef: input.executorRef,
		nodeId: input.nodeId,
		executionMode: "once",
		ports: { result: {} },
		artifacts: [],
		evidence: input.evidence ?? {},
		itemRuns: [],
	};
}

function run(input: Readonly<{
	id: string;
	nodeId: string;
	status?: string;
	outputRefs: WorkflowNodeOutputV1;
}>): NodeRunRow {
	return {
		id: input.id,
		execution_id: "execution-1",
		node_id: input.nodeId,
		status: input.status ?? "success",
		attempt: 1,
		error_message: null,
		output_refs: JSON.stringify(input.outputRefs),
		created_at: "2026-08-29T00:00:00.000Z",
		started_at: "2026-08-29T00:00:00.000Z",
		finished_at: "2026-08-29T00:00:01.000Z",
	};
}

const expectedBeatSheet = createWorkflowArtifactContract({
	artifactType: "tapcanvas.beat-sheet/v2",
	schemaVersion: "2",
	constraints: { durationOptions: [4, 5, 6, 7, 8, 9, 10] },
});

function rejectionFor(bindings: Parameters<typeof createWorkflowInputContractRejection>[0]["inputBindings"]) {
	return createWorkflowInputContractRejection({
		consumerNodeId: "clip-fan-out",
		inputBindings: bindings,
		error: new WorkflowInputContractError({
			targetPortId: "beat-sheet",
			expectedContract: expectedBeatSheet,
			cause: new Error("duration mismatch"),
		}),
	});
}

describe("workflow recovery frontier", () => {
	it("follows exact persisted input lineage and never selects a closer sibling Agent", () => {
		const formatterRun = run({
			id: "run-format",
			nodeId: "beat-format",
			outputRefs: output({
				nodeId: "beat-format",
				executorRef: "workflow.collection.take/v1",
				evidence: {
					workflowProvenance: {
						protocolVersion: "workflow.node-provenance/v1",
						executionId: "execution-1",
						nodeRunId: "run-format",
						attempt: 1,
						flowId: "flow-1",
						flowVersionId: "flow-version-1",
						nodeId: "beat-format",
						executorRef: "workflow.collection.take/v1",
						createdAt: "2026-08-29T00:00:01.000Z",
						inputBindings: [{
							sourceNodeId: "beat-agent",
							sourceNodeRunId: "run-beat-agent",
							sourcePortId: "result",
							targetPortId: "items",
							artifacts: [],
						}],
					},
				},
			}),
		});
		const failedRun = run({
			id: "run-failed",
			nodeId: "clip-fan-out",
			status: "failed",
			outputRefs: output({
				nodeId: "clip-fan-out",
				executorRef: "video.clip-contexts/v1",
				evidence: {
					inputContractRejection: rejectionFor([{
						sourceNodeId: "beat-format",
						sourceNodeRunId: "run-format",
						sourcePortId: "result",
						targetPortId: "beat-sheet",
						artifacts: [],
					}]),
				},
			}),
		});
		const decision = resolveWorkflowRecoveryFrontier({
			failedNode: failedRun,
			nodeRuns: [
				run({ id: "run-beat-agent", nodeId: "beat-agent", outputRefs: output({ nodeId: "beat-agent", executorRef: "agents.logical-task/v2" }) }),
				run({ id: "run-launch-agent", nodeId: "launch-agent", outputRefs: output({ nodeId: "launch-agent", executorRef: "agents.logical-task/v2" }) }),
				formatterRun,
				failedRun,
			],
			flowData: {
				nodes: [
					graphNode("beat-agent", "agents.logical-task/v2"),
					graphNode("launch-agent", "agents.logical-task/v2"),
					graphNode("beat-format", "workflow.collection.take/v1"),
					graphNode("clip-fan-out", "video.clip-contexts/v1"),
				],
				edges: [],
			},
		});
		expect(decision).toEqual({
			invalidatedNodeIds: ["beat-agent"],
			mode: "input_contract_lineage",
			rejectedBindingCount: 1,
			unresolvedBindingCount: 0,
		});
	});

	it("supports multiple exact dirty frontiers for independent rejected inputs", () => {
		const failedRun = run({
			id: "run-failed",
			nodeId: "clip-fan-out",
			status: "failed",
			outputRefs: output({
				nodeId: "clip-fan-out",
				executorRef: "video.clip-contexts/v1",
				evidence: {
					inputContractRejection: rejectionFor([
						{ sourceNodeId: "agent-b", sourceNodeRunId: "run-b", sourcePortId: "result", targetPortId: "beat-sheet", artifacts: [] },
						{ sourceNodeId: "agent-a", sourceNodeRunId: "run-a", sourcePortId: "result", targetPortId: "beat-sheet", artifacts: [] },
					]),
				},
			}),
		});
		const decision = resolveWorkflowRecoveryFrontier({
			failedNode: failedRun,
			nodeRuns: [
				run({ id: "run-a", nodeId: "agent-a", outputRefs: output({ nodeId: "agent-a", executorRef: "agents.logical-task/v2" }) }),
				run({ id: "run-b", nodeId: "agent-b", outputRefs: output({ nodeId: "agent-b", executorRef: "agents.logical-task/v2" }) }),
				failedRun,
			],
			flowData: {
				nodes: [graphNode("agent-a", "agents.logical-task/v2"), graphNode("agent-b", "agents.logical-task/v2"), graphNode("clip-fan-out", "video.clip-contexts/v1")],
				edges: [],
			},
		});
		expect(decision.invalidatedNodeIds).toEqual(["agent-a", "agent-b"]);
		expect(decision.mode).toBe("input_contract_lineage");
	});

	it("does not guess through an ambiguous multi-input transform", () => {
		const transformRun = run({
			id: "run-transform",
			nodeId: "transform",
			outputRefs: output({
				nodeId: "transform",
				executorRef: "workflow.collection.concat/v1",
				evidence: {
					workflowProvenance: {
						protocolVersion: "workflow.node-provenance/v1",
						executionId: "execution-1",
						nodeRunId: "run-transform",
						attempt: 1,
						flowId: "flow-1",
						flowVersionId: "flow-version-1",
						nodeId: "transform",
						executorRef: "workflow.collection.concat/v1",
						createdAt: "2026-08-29T00:00:01.000Z",
						inputBindings: [
							{ sourceNodeId: "agent-a", sourceNodeRunId: "run-a", sourcePortId: "result", targetPortId: "left", artifacts: [] },
							{ sourceNodeId: "agent-b", sourceNodeRunId: "run-b", sourcePortId: "result", targetPortId: "right", artifacts: [] },
						],
					},
				},
			}),
		});
		const failedRun = run({
			id: "run-failed",
			nodeId: "clip-fan-out",
			status: "failed",
			outputRefs: output({
				nodeId: "clip-fan-out",
				executorRef: "video.clip-contexts/v1",
				evidence: { inputContractRejection: rejectionFor([{
					sourceNodeId: "transform",
					sourceNodeRunId: "run-transform",
					sourcePortId: "result",
					targetPortId: "beat-sheet",
					artifacts: [],
				}]) },
			}),
		});
		const decision = resolveWorkflowRecoveryFrontier({
			failedNode: failedRun,
			nodeRuns: [transformRun, failedRun],
			flowData: { nodes: [graphNode("transform", "workflow.collection.concat/v1"), graphNode("clip-fan-out", "video.clip-contexts/v1")], edges: [] },
		});
		expect(decision).toEqual({
			invalidatedNodeIds: ["clip-fan-out"],
			mode: "failed_node",
			rejectedBindingCount: 1,
			unresolvedBindingCount: 1,
		});
	});
});
