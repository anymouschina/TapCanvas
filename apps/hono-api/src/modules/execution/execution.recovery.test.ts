import { describe, expect, it } from "vitest";
import {
	rebuildWorkflowExecutionGraph,
	resolveWorkflowNodeRestartPolicy,
	resolveWorkflowNodeRetryPolicy,
	workflowGraphHasCycle,
	compileWorkflowGraph,
	resolveWorkflowGraphNode,
} from "./execution.recovery";
import { freezeWorkflowExecutionSemanticsSnapshot } from "./execution.semantics-snapshot";

const flowData = freezeWorkflowExecutionSemanticsSnapshot({
	nodes: [
		{ id: "source", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.input.text/v1" } } },
		{ id: "agent", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "agents.logical-task/v2" } } },
		{ id: "video", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" } } },
	],
	edges: [
		{ source: "source", target: "agent" },
		{ source: "agent", target: "video" },
	],
});

describe("workflow execution recovery", () => {
	it("fails unchanged deterministic input once while leaving high-cost nodes checkpoint-only", () => {
		expect(resolveWorkflowNodeRetryPolicy(flowData, "source")).toEqual({ maxAttempts: 1, failureStage: "input" });
		expect(resolveWorkflowNodeRetryPolicy(flowData, "video")).toEqual({ maxAttempts: 1, failureStage: "media_generation" });
	});
	it("rejects dangling edges instead of silently dropping them", () => {
		expect(() => compileWorkflowGraph({
			nodes: [{ id: "trigger" }],
			edges: [{ id: "dangling", source: "trigger", target: "missing" }],
		})).toThrow("references a node outside the immutable graph");
	});

	it("rejects declared typed ports when an edge omits its handles", () => {
		expect(() => compileWorkflowGraph({
			nodes: [
				{ id: "trigger", data: { workflowAtomicSpec: { outputPorts: ["trigger"] } } },
				{ id: "output", data: { workflowAtomicSpec: { inputPorts: ["trigger"] } } },
			],
			edges: [{ id: "trigger-to-output", source: "trigger", target: "output" }],
		})).toThrow("requires explicit typed port handles");
	});

	it("rejects an authored node that omits an executor-required input before execution", () => {
		expect(() => compileWorkflowGraph({
			nodes: [{
				id: "handoff",
				data: {
					workflowAtomicSpec: {
						executorRef: "video.production.handoff/v1",
						inputPorts: ["prompt-package", "estimate", "asset-bindings"],
						outputPorts: ["production-plan"],
					},
				},
			}],
			edges: [],
		})).toThrow("omits executor-required input port voice-manifest");
	});

	it("rejects a stale asset fan-out that has no server-owned artifact port declaration", () => {
		expect(() => compileWorkflowGraph({
			nodes: [{
				id: "asset-fan-out",
				data: {
					workflowAtomicSpec: {
						executorRef: "video.asset-plans.split/v1",
						inputPorts: ["asset-plans", "beat-sheet", "asset-bindings"],
						outputPorts: ["asset-items"],
					},
				},
			}],
			edges: [],
		})).toThrow("must declare executor artifact contract");
	});

	it("accepts the current asset-plan v2 producer and image consumer contract", () => {
		expect(() => compileWorkflowGraph({
			nodes: [
				{
					id: "asset-fan-out",
					data: {
						workflowAtomicSpec: {
							executorRef: "video.asset-plans.split/v1",
							inputPorts: ["asset-plans", "beat-sheet", "asset-bindings"],
							optionalInputPorts: ["asset-plans", "beat-sheet", "asset-bindings"],
							outputPorts: ["asset-items"],
							inputArtifactTypes: {
								"asset-plans": ["tapcanvas.asset-plans/v1"],
								"beat-sheet": ["tapcanvas.beat-sheet/v2", "tapcanvas.launch-beat-sheet/v1"],
								"asset-bindings": ["tapcanvas.asset-bindings/v1"],
							},
							outputArtifactTypes: { "asset-items": ["tapcanvas.asset-plan-items/v2"] },
						},
					},
				},
				{
					id: "image",
					data: {
						workflowAtomicSpec: {
							executorRef: "tapcanvas.image.generate/v1",
							inputPorts: ["asset-items"],
							outputPorts: ["asset-bindings"],
							inputArtifactTypes: { "asset-items": ["tapcanvas.asset-plan-items/v2"] },
						},
					},
				},
			],
			edges: [{
				id: "asset-fan-out-to-image",
				source: "asset-fan-out",
				target: "image",
				sourceHandle: "out-workflow:asset-items",
				targetHandle: "in-workflow:asset-items",
			}],
		})).not.toThrow();
	});

	it("rejects an edge whose producer artifact version is outside the consumer contract", () => {
		expect(() => compileWorkflowGraph({
			nodes: [
				{
					id: "producer",
					data: {
						workflowAtomicSpec: {
							executorRef: "workflow.control.join/v1",
							inputPorts: [],
							outputPorts: ["asset-items"],
							outputArtifactTypes: { "asset-items": ["tapcanvas.asset-plan-items/v1"] },
						},
					},
				},
				{
					id: "image",
					data: {
						workflowAtomicSpec: {
							executorRef: "tapcanvas.image.generate/v1",
							inputPorts: ["asset-items"],
							outputPorts: ["asset-bindings"],
							inputArtifactTypes: { "asset-items": ["tapcanvas.asset-plan-items/v2"] },
						},
					},
				},
			],
			edges: [{
				id: "producer-to-image",
				source: "producer",
				target: "image",
				sourceHandle: "out-workflow:asset-items",
				targetHandle: "in-workflow:asset-items",
			}],
		})).toThrow("cannot deliver tapcanvas.asset-plan-items/v1");
	});
	it("classifies restart behavior by executor contract instead of node label or prompt", () => {
		expect(resolveWorkflowNodeRestartPolicy(flowData, "source")).toBe("replay_safe");
		expect(resolveWorkflowNodeRestartPolicy(flowData, "video")).toBe("reconcile_effect");
		expect(resolveWorkflowNodeRestartPolicy(flowData, "agent")).toBe("reconcile_effect");
		expect(resolveWorkflowNodeRestartPolicy(freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [{ id: "estimate", data: { workflowAtomicSpec: { executorRef: "video.estimate/v1" } } }],
		}), "estimate")).toBe("replay_safe");
	});

	it("fails explicitly when an immutable execution has no semantics snapshot", () => {
		expect(() => resolveWorkflowNodeRestartPolicy({
			nodes: [{ id: "source", data: { workflowAtomicSpec: { executorRef: "workflow.input.text/v1" } } }],
		}, "source")).toThrow(/semantics snapshot/u);
	});

	it("rebuilds the durable cursor from successful facts and pending nodes", () => {
		expect(rebuildWorkflowExecutionGraph({
			flowData,
			executionStatus: "running",
			concurrency: 20,
			latestEventSeq: 14,
			nodeRuns: [
				{ nodeId: "source", status: "success" },
				{ nodeId: "agent", status: "pending" },
				{ nodeId: "video", status: "pending" },
			],
		})).toMatchObject({
			status: "running",
			concurrency: 8,
			running: 0,
			seq: 14,
			indeg: { source: 0, agent: 0, video: 1 },
			ready: ["agent"],
		});
	});

	it("keeps failed execution reconstruction inert while preserving graph facts", () => {
		const recovered = rebuildWorkflowExecutionGraph({
			flowData,
			executionStatus: "failed",
			concurrency: 2,
			latestEventSeq: 9,
			nodeRuns: [
				{ nodeId: "source", status: "success" },
				{ nodeId: "agent", status: "failed" },
				{ nodeId: "video", status: "waiting_external" },
			],
		});
		expect(recovered.ready).toEqual([]);
		expect(recovered.indeg).toEqual({ source: 0, agent: 0, video: 1 });
	});

	it("detects cycles in the immutable graph", () => {
		const graph = compileWorkflowGraph({
			nodes: [{ id: "a" }, { id: "b" }],
			edges: [{ source: "a", target: "b" }, { source: "b", target: "a" }],
		});
		expect(workflowGraphHasCycle(graph)).toBe(true);
	});

	it("activates only the selected condition edge and still releases an active join", () => {
		const conditionalFlow = {
			nodes: [
				{ id: "condition", data: { workflowAtomicSpec: { inputPorts: [], outputPorts: ["matched", "unmatched"], selectiveOutputPorts: ["matched", "unmatched"] } } },
				{ id: "yes", data: { workflowAtomicSpec: { inputPorts: ["input"], outputPorts: ["result"] } } },
				{ id: "no", data: { workflowAtomicSpec: { inputPorts: ["input"], outputPorts: ["result"] } } },
				{ id: "join", data: { workflowAtomicSpec: { inputPorts: ["branches"], outputPorts: [] } } },
			],
			edges: [
				{ id: "matched", source: "condition", target: "yes", sourceHandle: "out-workflow:matched", targetHandle: "in-workflow:input" },
				{ id: "unmatched", source: "condition", target: "no", sourceHandle: "out-workflow:unmatched", targetHandle: "in-workflow:input" },
				{ id: "yes-join", source: "yes", target: "join", sourceHandle: "out-workflow:result", targetHandle: "in-workflow:branches" },
				{ id: "no-join", source: "no", target: "join", sourceHandle: "out-workflow:result", targetHandle: "in-workflow:branches" },
			],
		};
		const graph = rebuildWorkflowExecutionGraph({
			flowData: conditionalFlow,
			executionStatus: "running",
			concurrency: 2,
			latestEventSeq: 0,
			nodeRuns: [
				{ nodeId: "condition", status: "pending" },
				{ nodeId: "yes", status: "pending" },
				{ nodeId: "no", status: "pending" },
				{ nodeId: "join", status: "pending" },
			],
		});
		expect(graph.ready).toEqual(["condition"]);
		const conditionResolution = resolveWorkflowGraphNode(graph, {
			nodeId: "condition",
			status: "success",
			outputRefs: { ports: { matched: { matched: true } } },
		});
		expect(conditionResolution.readyNodeIds).toEqual(["yes"]);
		expect(conditionResolution.notSelectedNodeIds).toEqual(["no"]);
		expect(graph.indeg.join).toBe(1);
		const yesResolution = resolveWorkflowGraphNode(graph, {
			nodeId: "yes",
			status: "success",
			outputRefs: { ports: { result: "ok" } },
		});
		expect(yesResolution.readyNodeIds).toEqual(["join"]);
	});
});
