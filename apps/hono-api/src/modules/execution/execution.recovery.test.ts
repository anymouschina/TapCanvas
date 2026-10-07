import { describe, expect, it } from "vitest";
import {
	rebuildWorkflowExecutionGraph,
	resolveWorkflowNodeRestartPolicy,
	resolveWorkflowNodeRetryPolicy,
	workflowGraphHasCycle,
	compileWorkflowGraph,
	compileFrozenWorkflowGraph,
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

function expandedSourceAuthoringFlow() {
	const stage = (
		id: string,
		inputPorts: readonly string[],
		outputPorts: readonly string[],
		optionalInputPorts: readonly string[] = [],
	) => ({
		id,
		type: "taskNode",
		data: {
			kind: "workflowStage",
			workflowAtomicSpec: {
				version: 1,
				category: "agent" as const,
				operation: id,
				executorRef: null,
				executionMode: "once" as const,
				inputPorts: [...inputPorts],
				...(optionalInputPorts.length > 0 ? { optionalInputPorts: [...optionalInputPorts] } : {}),
				outputPorts: [...outputPorts],
			},
		},
	});
	return {
		nodes: [
			stage("canvas-source", [], ["canvas-facts"]),
			stage("text-expansion-agent", ["canvas-facts"], ["expanded-source"]),
			stage("delivery-contract", ["canvas-facts"], ["delivery-contract"], ["expanded-source"]),
			stage("source-units-agent", ["delivery-contract"], ["source-ledger"]),
			stage("chapter-assets-agent", ["delivery-contract"], ["chapter-assets"]),
			stage("beat-sheet-agent", ["delivery-contract", "source-ledger"], ["chapter-plan"], ["expanded-source"]),
		],
		edges: [
			{ id: "source-to-expansion", source: "canvas-source", target: "text-expansion-agent", sourceHandle: "out-workflow:canvas-facts", targetHandle: "in-workflow:canvas-facts" },
			{ id: "source-to-delivery", source: "canvas-source", target: "delivery-contract", sourceHandle: "out-workflow:canvas-facts", targetHandle: "in-workflow:canvas-facts" },
			{ id: "expansion-to-beat", source: "text-expansion-agent", target: "beat-sheet-agent", sourceHandle: "out-workflow:expanded-source", targetHandle: "in-workflow:expanded-source" },
			{ id: "delivery-to-source-ledger", source: "delivery-contract", target: "source-units-agent", sourceHandle: "out-workflow:delivery-contract", targetHandle: "in-workflow:delivery-contract" },
			{ id: "delivery-to-assets", source: "delivery-contract", target: "chapter-assets-agent", sourceHandle: "out-workflow:delivery-contract", targetHandle: "in-workflow:delivery-contract" },
			{ id: "delivery-to-beat", source: "delivery-contract", target: "beat-sheet-agent", sourceHandle: "out-workflow:delivery-contract", targetHandle: "in-workflow:delivery-contract" },
			{ id: "source-ledger-to-beat", source: "source-units-agent", target: "beat-sheet-agent", sourceHandle: "out-workflow:source-ledger", targetHandle: "in-workflow:source-ledger" },
		],
	};
}

type AuthoringFlow = ReturnType<typeof expandedSourceAuthoringFlow>;

function canonicalAuthoringFlow(): AuthoringFlow {
	const flow = expandedSourceAuthoringFlow();
	return {
		nodes: flow.nodes.filter((node) => node.id !== "text-expansion-agent"),
		edges: flow.edges.filter((edge) => edge.source !== "text-expansion-agent" && edge.target !== "text-expansion-agent" && edge.targetHandle !== "in-workflow:expanded-source"),
	};
}

function pendingAuthoringRuns(flow: AuthoringFlow) {
	return flow.nodes.map((node) => ({ nodeId: node.id, status: "pending" as const }));
}

function outputFor(port: string): { ports: Record<string, { value: string }> } {
	return { ports: { [port]: { value: port } } };
}

describe("workflow execution recovery", () => {
	it("retries video submission twice through reconciliation while deterministic inputs run once", () => {
		expect(resolveWorkflowNodeRetryPolicy(flowData, "source")).toEqual({ maxAttempts: 1, failureStage: "input" });
		expect(resolveWorkflowNodeRetryPolicy(flowData, "video")).toEqual({ maxAttempts: 3, failureStage: "media_generation" });
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
			concurrency: 16,
			running: 0,
			seq: 14,
			indeg: { source: 0, agent: 0, video: 1 },
			ready: ["agent"],
		});
	});

	it("waits for a connected optional expanded-source edge before releasing BeatSheet", () => {
		const flow = expandedSourceAuthoringFlow();
		const graph = rebuildWorkflowExecutionGraph({
			flowData: flow,
			executionStatus: "running",
			concurrency: 8,
			latestEventSeq: 0,
			nodeRuns: pendingAuthoringRuns(flow),
		});

		const sourceResolution = resolveWorkflowGraphNode(graph, {
			nodeId: "canvas-source",
			status: "success",
			outputRefs: outputFor("canvas-facts"),
		});
		expect(sourceResolution.readyNodeIds).toEqual(["text-expansion-agent", "delivery-contract"]);

		const deliveryResolution = resolveWorkflowGraphNode(graph, {
			nodeId: "delivery-contract",
			status: "success",
			outputRefs: outputFor("delivery-contract"),
		});
		expect(deliveryResolution.readyNodeIds).toEqual(["source-units-agent", "chapter-assets-agent"]);
		expect(graph.indeg["beat-sheet-agent"]).toBe(2);

		const ledgerResolution = resolveWorkflowGraphNode(graph, {
			nodeId: "source-units-agent",
			status: "success",
			outputRefs: outputFor("source-ledger"),
		});
		expect(ledgerResolution.readyNodeIds).toEqual([]);
		expect(graph.indeg["beat-sheet-agent"]).toBe(1);

		const expansionResolution = resolveWorkflowGraphNode(graph, {
			nodeId: "text-expansion-agent",
			status: "success",
			outputRefs: outputFor("expanded-source"),
		});
		expect(expansionResolution.readyNodeIds).toEqual(["beat-sheet-agent"]);
	});

	it("releases canonical source and chapter asset branches without waiting for expansion", () => {
		const flow = expandedSourceAuthoringFlow();
		const graph = rebuildWorkflowExecutionGraph({
			flowData: flow,
			executionStatus: "running",
			concurrency: 8,
			latestEventSeq: 0,
			nodeRuns: pendingAuthoringRuns(flow),
		});

		resolveWorkflowGraphNode(graph, {
			nodeId: "canvas-source",
			status: "success",
			outputRefs: outputFor("canvas-facts"),
		});
		const deliveryResolution = resolveWorkflowGraphNode(graph, {
			nodeId: "delivery-contract",
			status: "success",
			outputRefs: outputFor("delivery-contract"),
		});

		expect(deliveryResolution.readyNodeIds).toEqual(expect.arrayContaining(["source-units-agent", "chapter-assets-agent"]));
		expect(deliveryResolution.readyNodeIds).not.toContain("beat-sheet-agent");
		expect(graph.indeg["source-units-agent"]).toBe(0);
		expect(graph.indeg["chapter-assets-agent"]).toBe(0);
		expect(graph.indeg["beat-sheet-agent"]).toBe(2);
	});

	it("releases the full-video BeatSheet after canonical source ledger without an expansion node", () => {
		const flow = canonicalAuthoringFlow();
		const graph = rebuildWorkflowExecutionGraph({
			flowData: flow,
			executionStatus: "running",
			concurrency: 8,
			latestEventSeq: 0,
			nodeRuns: pendingAuthoringRuns(flow),
		});

		resolveWorkflowGraphNode(graph, {
			nodeId: "canvas-source",
			status: "success",
			outputRefs: outputFor("canvas-facts"),
		});
		resolveWorkflowGraphNode(graph, {
			nodeId: "delivery-contract",
			status: "success",
			outputRefs: outputFor("delivery-contract"),
		});
		const ledgerResolution = resolveWorkflowGraphNode(graph, {
			nodeId: "source-units-agent",
			status: "success",
			outputRefs: outputFor("source-ledger"),
		});

		expect(ledgerResolution.readyNodeIds).toContain("beat-sheet-agent");
		expect(graph.indeg["beat-sheet-agent"]).toBe(0);
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

it("does not activate an unselected required port when an independent data port is ready", () => {
 const spec = (inputPorts: string[], outputPorts: string[], selectiveOutputPorts: string[] = []) => ({ workflowAtomicSpec: { inputPorts, outputPorts, selectiveOutputPorts } });
 const flowData = { nodes: [
  { id: "choice", data: spec([], ["yes", "no"], ["yes", "no"]) },
  { id: "plan", data: spec([], ["data"]) },
  { id: "prepare", data: spec(["authorization", "plan"], []) },
  { id: "submit", data: spec(["authorization", "plan"], []) },
 ], edges: [
  { id: "a", source: "choice", target: "prepare", sourceHandle: "out-workflow:yes", targetHandle: "in-workflow:authorization" },
  { id: "b", source: "choice", target: "submit", sourceHandle: "out-workflow:no", targetHandle: "in-workflow:authorization" },
  ...["prepare", "submit"].map(target => ({ id: target, source: "plan", target, sourceHandle: "out-workflow:data", targetHandle: "in-workflow:plan" })),
 ] };
 const graph = rebuildWorkflowExecutionGraph({ flowData, executionStatus: "running", concurrency: 2, latestEventSeq: 0, nodeRuns: flowData.nodes.map(n => ({ nodeId: n.id, status: "pending" })) });
 resolveWorkflowGraphNode(graph, { nodeId: "choice", status: "success", outputRefs: { ports: { yes: true } } });
 const resolved = resolveWorkflowGraphNode(graph, { nodeId: "plan", status: "success", outputRefs: { ports: { data: {} } } });
 expect(resolved.readyNodeIds).toEqual(["prepare"]);
 expect(resolved.notSelectedNodeIds).toEqual(["submit"]);
});


describe("immutable execution contract recovery", () => {
	const snapshot = {
		nodes: [
			{ id: "source", data: { workflowAtomicSpec: { outputPorts: ["source"],
				outputArtifactTypes: { source: ["test.accepted-source/v1"] } } } },
			{ id: "settled-transform", data: { workflowAtomicSpec: {
				executorRef: "video.asset-plans.split/v1", inputPorts: ["asset-plans"], outputPorts: ["asset-items"],
				inputArtifactTypes: { "asset-plans": ["test.accepted-source/v1"] },
				outputArtifactTypes: { "asset-items": ["test.accepted-items/v1"] },
			} } },
			{ id: "remaining", data: { workflowAtomicSpec: { inputPorts: ["items"],
				inputArtifactTypes: { items: ["test.accepted-items/v1"] } } } },
		],
		edges: [
			{ source: "source", target: "settled-transform", sourceHandle: "out-workflow:source", targetHandle: "in-workflow:asset-plans" },
			{ source: "settled-transform", target: "remaining", sourceHandle: "out-workflow:asset-items", targetHandle: "in-workflow:items" },
		],
	};

	it("keeps current registry checks at new admission while recovering accepted output contracts", () => {
		expect(() => compileWorkflowGraph(snapshot)).toThrow("executor artifact contract");
		expect(compileFrozenWorkflowGraph(snapshot).nodeIds).toEqual(["source", "settled-transform", "remaining"]);
		const recovered = rebuildWorkflowExecutionGraph({ flowData: snapshot, executionStatus: "running",
			concurrency: 2, latestEventSeq: 7, nodeRuns: [
				{ nodeId: "source", status: "success", outputRefs: { ports: { source: {} } } },
				{ nodeId: "settled-transform", status: "success", outputRefs: { ports: { "asset-items": {} } } },
				{ nodeId: "remaining", status: "pending" },
			] });
		expect(recovered.ready).toEqual(["remaining"]);
		expect(recovered.seq).toBe(7);
	});

	it("still rejects broken frozen artifact edges and unknown handles", () => {
		const wrongType = structuredClone(snapshot);
		wrongType.nodes[2]!.data.workflowAtomicSpec.inputArtifactTypes = { items: ["test.other/v1"] };
		expect(() => compileFrozenWorkflowGraph(wrongType)).toThrow("cannot deliver");
		const wrongHandle = structuredClone(snapshot);
		wrongHandle.edges[1]!.targetHandle = "in-workflow:missing";
		expect(() => compileFrozenWorkflowGraph(wrongHandle)).toThrow("does not declare input port missing");
	});
});
