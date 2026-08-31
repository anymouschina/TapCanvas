import { describe, expect, it } from "vitest";
import {
	applyWorkflowDefinitionCutover,
	prepareWorkflowExecutionSnapshotRerun,
} from "./execution.snapshot-runtime";

describe("prepareWorkflowExecutionSnapshotRerun", () => {
	it("keeps the frozen graph and removes physical-run output reuse receipts", () => {
		const frozenProjectContext = {
			version: 3,
			projectId: "project-1",
			canvasId: "canvas-1",
			assetSnapshot: [{
				assetId: "asset-1",
				origin: "project_node",
				contentFingerprint: null,
			}],
		};
		const result = prepareWorkflowExecutionSnapshotRerun({
			nodes: [{
				id: "trigger-1",
				data: {
					workflowPinnedOutputSource: { version: 1, sourceExecutionId: "pin-exec", sourceNodeRunId: "pin-run" },
					workflowResolvedOutputReuse: { version: 1, kind: "replay" },
					workflowResolvedReplayCheckpoint: {
						version: 1,
						kind: "replay_checkpoint",
						sourceExecutionId: "older-exec",
						sourceNodeRunId: "older-run",
					},
				},
			}],
			edges: [],
			workflowExecutionScope: {
				version: 1,
				triggerNodeId: "trigger-1",
				stopAfterNodeId: "stage-2",
			},
			workflowProjectContext: frozenProjectContext,
			workflowCallerCanvasSnapshot: {
				nodes: [{ id: "caller-node", position: { x: 480, y: 720 } }],
				edges: [],
			},
		});

		expect(result.triggerNodeId).toBe("trigger-1");
		expect(result.stopAfterNodeId).toBe("stage-2");
		expect(result.data.nodes).toEqual([{
			id: "trigger-1",
			data: {
				workflowPinnedOutputSource: { version: 1, sourceExecutionId: "pin-exec", sourceNodeRunId: "pin-run" },
			},
		}]);
		expect(result.data.workflowProjectContext).toEqual(frozenProjectContext);
		expect(result.data.workflowCallerCanvasSnapshot).toEqual({
			nodes: [{ id: "caller-node", position: { x: 480, y: 720 } }],
			edges: [],
		});
	});

	it("fails explicitly when the immutable execution scope is absent", () => {
		expect(() => prepareWorkflowExecutionSnapshotRerun({ nodes: [], edges: [] }))
			.toThrow("workflowExecutionScope");
	});
});

describe("applyWorkflowDefinitionCutover", () => {
	const node = (id: string, config: string) => ({
		id,
		type: "taskNode",
		data: {
			kind: id === "trigger" ? "workflowTrigger" : "workflowStage",
			adminWorkflow: true,
			workflowInstanceId: "workflow-1",
			config,
			workflowAtomicSpec: {
				executorRef: id === "trigger" ? "workflow.trigger/v1" : "video.voice-manifest.materialize/v1",
				executionMode: "once",
				inputPorts: id === "trigger" ? [] : ["input"],
				outputPorts: ["output"],
			},
		},
	});
	const edge = { source: "trigger", sourceHandle: "output", target: "voice", targetHandle: "input" };
	const audit = {
		fromFlowVersionId: "version-old",
		currentFlowUpdatedAt: "2026-08-28T12:30:44.068Z",
		authorizedBy: "owner-1",
		requestedAt: "2026-08-28T12:40:00.000Z",
	};

	it("takes current authored configuration while preserving frozen invocation facts", () => {
		const result = applyWorkflowDefinitionCutover({
			frozenSnapshot: {
				nodes: [{
					...node("trigger", "old"),
					data: { ...node("trigger", "old").data, workflowTriggerPayload: { request: "chapter one" } },
				}, node("voice", "old")],
				edges: [edge],
				workflowExecutionScope: { triggerNodeId: "trigger" },
				workflowSourceSnapshots: { group: { frozen: true } },
				workflowProjectContext: { projectId: "project-1", canvasId: "chapter-1" },
				workflowDeliveryScope: { flowId: "chapter-1" },
			},
			currentScopedDefinition: {
				nodes: [node("trigger", "current"), node("voice", "provider-native")],
				edges: [edge],
				workflowExecutionScope: { triggerNodeId: "trigger" },
				workflowSourceSnapshots: { group: { mutable: true } },
			},
			audit,
		});
		const byId = new Map((result.nodes as Array<{ id: string; data: Record<string, unknown> }>).map((value) => [value.id, value.data]));
		expect(byId.get("voice")?.config).toBe("provider-native");
		expect(byId.get("trigger")?.workflowTriggerPayload).toEqual({ request: "chapter one" });
		expect(result.workflowProjectContext).toEqual({ projectId: "project-1", canvasId: "chapter-1" });
		expect(result.workflowSourceSnapshots).toEqual({ group: { frozen: true } });
		expect(result.workflowDefinitionCutovers).toEqual([expect.objectContaining({ mode: "current_flow", ...audit })]);
	});

	it("rejects topology and executor drift", () => {
		const frozen = {
			nodes: [node("trigger", "old"), node("voice", "old")],
			edges: [edge],
			workflowExecutionScope: { triggerNodeId: "trigger" },
		};
		expect(() => applyWorkflowDefinitionCutover({
			frozenSnapshot: frozen,
			currentScopedDefinition: {
				nodes: [node("trigger", "current"), {
					...node("voice", "current"),
					data: {
						...node("voice", "current").data,
						workflowAtomicSpec: {
							...node("voice", "current").data.workflowAtomicSpec,
							executorRef: "different/v1",
						},
					},
				}],
				edges: [edge],
				workflowExecutionScope: { triggerNodeId: "trigger" },
			},
			audit,
		})).toThrow("executorRef");
	});
});
