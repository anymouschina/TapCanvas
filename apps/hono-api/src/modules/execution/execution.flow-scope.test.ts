import { describe, expect, it } from "vitest";
import { scopeWorkflowFlowData } from "./execution.flow-scope";

function inlineStepNode(
	id: string,
	inputPorts: readonly string[],
	outputPorts: readonly string[],
	inputArtifactTypes: Readonly<Record<string, readonly string[]>> = {},
	outputArtifactTypes: Readonly<Record<string, readonly string[]>> = {},
	executionMode: "once" | "each" | "collect" = "once",
): Record<string, unknown> {
	return {
		id,
		type: "taskNode",
		kind: "workflowStage",
		data: {
			kind: "workflowStage",
			workflowInputPorts: [...inputPorts],
			workflowOutputPorts: [...outputPorts],
			workflowAtomicSpec: {
				version: 1,
				category: "control",
				operation: id,
				executorRef: `test.${id}/v1`,
				executionMode,
				inputPorts: [...inputPorts],
				outputPorts: [...outputPorts],
				inputArtifactTypes,
				outputArtifactTypes,
			},
		},
	};
}

function nestedCheckpointGraph(): Record<string, unknown> {
	const steps = [
		{ stepId: "writer", node: inlineStepNode("writer", ["segments", "contract"], ["packets"], { segments: ["segments"], contract: ["contract"] }, { packets: ["packets"] }, "each") },
		{ stepId: "collect", node: inlineStepNode("collect", ["packets", "segments"], ["production"], { packets: ["packets"], segments: ["segments"] }, { production: ["production"] }, "collect") },
		{ stepId: "materialize", node: inlineStepNode("materialize", ["production", "contract"], ["node-plan", "prompt-package", "prepared-nodes"], { production: ["production"], contract: ["contract"] }, { "node-plan": ["node-plan"], "prompt-package": ["prompt-package"], "prepared-nodes": ["video-node"] }) },
		{ stepId: "paid-media", node: inlineStepNode("paid-media", ["prepared-nodes", "authorization"], ["video-assets"], { "prepared-nodes": ["video-node"], authorization: ["authorization"] }, { "video-assets": ["video-assets"] }, "each") },
	];
	const workflowPipeline = {
		protocolVersion: "workflow.pipeline.run/v1",
		inputs: [
			{ portId: "segments", mode: "value", artifactTypes: ["segments"], itemArtifactTypes: ["segment"] },
			{ portId: "contract", mode: "value", artifactTypes: ["contract"] },
			{ portId: "authorization", mode: "value", artifactTypes: [] },
		],
		steps,
		bindings: [
			{ from: { kind: "input", portId: "segments" }, to: { stepId: "writer", portId: "segments" }, mode: "collection" },
			{ from: { kind: "input", portId: "contract" }, to: { stepId: "writer", portId: "contract" }, mode: "value" },
			{ from: { kind: "step", stepId: "writer", portId: "packets" }, to: { stepId: "collect", portId: "packets" }, mode: "collection" },
			{ from: { kind: "input", portId: "segments" }, to: { stepId: "collect", portId: "segments" }, mode: "collection" },
			{ from: { kind: "step", stepId: "collect", portId: "production" }, to: { stepId: "materialize", portId: "production" }, mode: "collection" },
			{ from: { kind: "input", portId: "contract" }, to: { stepId: "materialize", portId: "contract" }, mode: "value" },
			{ from: { kind: "step", stepId: "materialize", portId: "prepared-nodes" }, to: { stepId: "paid-media", portId: "prepared-nodes" }, mode: "collection" },
			{ from: { kind: "input", portId: "authorization" }, to: { stepId: "paid-media", portId: "authorization" }, mode: "value" },
		],
		outputs: [{ portId: "video-assets", from: { stepId: "paid-media", portId: "video-assets" }, mode: "collection" }],
	};
	const atomicStage = (id: string, outputPort: string, artifactType: string, sourceGroupId?: string) => ({
		id,
		type: "taskNode",
		data: {
			kind: "workflowStage",
			adminWorkflow: true,
			workflowInstanceId: "wf-nested",
			workflowAtomicSpec: { version: 1, category: "source", operation: id, executorRef: `test.${id}/v1`, executionMode: "once", inputPorts: [], outputPorts: [outputPort], outputArtifactTypes: { [outputPort]: [artifactType] } },
			...(sourceGroupId ? { sourceGroupId } : {}),
		},
	});
	const pipelineOutputPorts = ["video-assets"];
	return {
		nodes: [
			{ id: "source-group", type: "groupNode", data: {} },
			{ id: "paid-group", type: "groupNode", data: {} },
			{ id: "source-child", type: "taskNode", parentId: "source-group", data: {} },
			{ id: "paid-child", type: "taskNode", parentId: "paid-group", data: {} },
			{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-nested" } },
			atomicStage("segments", "segments", "segments", "source-group"),
			atomicStage("contract", "contract", "contract"),
			atomicStage("authorization", "authorization", "authorization"),
			{
				id: "pipeline",
				type: "taskNode",
				data: {
					kind: "workflowStage",
					adminWorkflow: true,
					workflowInstanceId: "wf-nested",
					sourceGroupId: "source-group",
					workflowInputPorts: ["segments", "contract", "authorization"],
					workflowOutputPorts: pipelineOutputPorts,
					workflowPipeline,
					workflowAtomicSpec: {
						version: 1, category: "subworkflow", operation: "inline_pipeline", executorRef: "workflow.pipeline.run/v1", executionMode: "each",
						inputPorts: ["segments", "contract", "authorization"], optionalInputPorts: [], outputPorts: pipelineOutputPorts,
						selectiveOutputPorts: pipelineOutputPorts,
						inputArtifactTypes: { segments: ["segments"], contract: ["contract"] },
						outputArtifactTypes: { "video-assets": ["video-assets"] },
					},
				},
			},
			{ ...atomicStage("after-pipeline", "result", "result", "paid-group"), data: { ...atomicStage("after-pipeline", "result", "result", "paid-group").data, inputPorts: ["video-assets"] } },
		],
		edges: [
			{ id: "trigger-segments", source: "trigger", target: "segments" },
			{ id: "trigger-contract", source: "trigger", target: "contract" },
			{ id: "trigger-authorization", source: "trigger", target: "authorization" },
			{ id: "segments-pipeline", source: "segments", target: "pipeline", targetHandle: "in-workflow:segments" },
			{ id: "contract-pipeline", source: "contract", target: "pipeline", targetHandle: "in-workflow:contract" },
			{ id: "authorization-pipeline", source: "authorization", target: "pipeline", targetHandle: "in-workflow:authorization" },
			{ id: "pipeline-paid", source: "pipeline", sourceHandle: "out-workflow:video-assets", target: "after-pipeline" },
		],
	};
}

describe("workflow execution flow scope", () => {
	it("freezes only the reachable administrator workflow instance", () => {
		const scoped = scopeWorkflowFlowData({
			nodes: [
				{ id: "source-group", type: "groupNode", data: { label: "冻结来源" } },
				{ id: "normal", type: "taskNode", parentId: "source-group", data: { kind: "image" } },
				{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1", workflowKey: "agent-workflow/v1", sourceGroupId: "source-group" } },
				{ id: "agent", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1", sourceGroupId: "source-group" } },
				{ id: "detached", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "other", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-2" } },
			],
			edges: [
				{ id: "reachable", source: "trigger", target: "agent" },
				{ id: "normal-edge", source: "normal", target: "trigger" },
				{ id: "other-edge", source: "trigger", target: "other" },
			],
			viewport: { x: 1, y: 2, zoom: 1 },
		}, "trigger");

		expect((scoped.nodes as Array<{ id: string }>).map((node) => node.id)).toEqual(["trigger", "agent"]);
		expect((scoped.edges as Array<{ id: string }>).map((edge) => edge.id)).toEqual(["reachable"]);
			expect(scoped.workflowExecutionScope).toEqual({
			version: 1,
			triggerNodeId: "trigger",
			workflowInstanceId: "wf-1",
			workflowKey: "agent-workflow/v1",
		});
		expect(scoped.workflowSourceSnapshots).toEqual({
			"source-group": {
				group: expect.objectContaining({ id: "source-group" }),
				children: [expect.objectContaining({ id: "normal" })],
			},
		});
	});

	it("rejects a trigger without a reachable atomic graph", () => {
		expect(() => scopeWorkflowFlowData({
			nodes: [{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } }],
			edges: [],
		}, "trigger")).toThrow(/no reachable atomic nodes/u);
	});

	it("freezes only the dependency prefix required by a stop node", () => {
		const scoped = scopeWorkflowFlowData({
			nodes: [
				{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "source", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "planner", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "delivery", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
			],
			edges: [
				{ id: "e1", source: "trigger", target: "source" },
				{ id: "e2", source: "source", target: "planner" },
				{ id: "e3", source: "planner", target: "delivery" },
			],
		}, "trigger", "planner");

		expect((scoped.nodes as Array<{ id: string }>).map((node) => node.id)).toEqual(["trigger", "source", "planner"]);
		expect((scoped.edges as Array<{ id: string }>).map((edge) => edge.id)).toEqual(["e1", "e2"]);
		expect(scoped.workflowExecutionScope).toEqual({
			version: 1,
			triggerNodeId: "trigger",
			workflowInstanceId: "wf-1",
			stopAfterNodeId: "planner",
		});
	});

	it("rejects a stop node outside the trigger dependency graph", () => {
		expect(() => scopeWorkflowFlowData({
			nodes: [
				{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "source", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "detached", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
			],
			edges: [{ id: "e1", source: "trigger", target: "source" }],
		}, "trigger", "detached")).toThrow(/not reachable/u);
	});

	it("rejects another trigger as a stop cursor", () => {
		expect(() => scopeWorkflowFlowData({
			nodes: [
				{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "schedule", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } },
			],
			edges: [{ id: "e1", source: "trigger", target: "schedule" }],
	}, "trigger", "schedule")).toThrow(/not an atomic workflow stage/u);
	});

	it("projects a nested checkpoint through declared target outputs and clips later inputs and media work", () => {
		const graph = nestedCheckpointGraph();
		const original = JSON.stringify(graph);
		const scoped = scopeWorkflowFlowData(graph, "trigger", "pipeline::step::materialize", "pipeline");
		const nodes = scoped.nodes as Array<{ id: string; data?: Record<string, unknown> }>;
		const pipeline = nodes.find((node) => node.id === "pipeline");
		if (!pipeline?.data) throw new Error("Expected scoped pipeline node");
		const scopedSpec = pipeline.data.workflowPipeline as { steps: Array<{ stepId: string }>; inputs: Array<{ portId: string }>; outputs: Array<{ portId: string; from: { stepId: string; portId: string }; mode: string }> };
		const scopedAtomic = pipeline.data.workflowAtomicSpec as { inputPorts: string[]; outputPorts: string[]; outputArtifactTypes: Record<string, string[]>; selectiveOutputPorts: string[] };
		expect(scopedSpec.steps.map((step) => step.stepId)).toEqual(["writer", "collect", "materialize"]);
		expect(scopedSpec.inputs.map((input) => input.portId)).toEqual(["segments", "contract"]);
		expect(scopedSpec.outputs).toEqual([
			{ portId: "node-plan", from: { stepId: "materialize", portId: "node-plan" }, mode: "value" },
			{ portId: "prompt-package", from: { stepId: "materialize", portId: "prompt-package" }, mode: "value" },
			{ portId: "prepared-nodes", from: { stepId: "materialize", portId: "prepared-nodes" }, mode: "value" },
		]);
		expect(scopedAtomic.inputPorts).toEqual(["segments", "contract"]);
		expect(scopedAtomic.outputPorts).toEqual(["node-plan", "prompt-package", "prepared-nodes"]);
		expect(scopedAtomic.outputArtifactTypes).toEqual({ "node-plan": ["node-plan"], "prompt-package": ["prompt-package"], "prepared-nodes": ["video-node"] });
		expect(scopedAtomic.selectiveOutputPorts).toEqual([]);
		expect((scoped.edges as Array<{ id: string }>).map((edge) => edge.id)).not.toContain("authorization-pipeline");
		expect((scoped.edges as Array<{ id: string }>).map((edge) => edge.id)).not.toContain("pipeline-paid");
		expect(nodes.map((node) => node.id)).not.toContain("after-pipeline");
		expect(scoped.workflowSourceSnapshots).not.toHaveProperty("paid-group");
		expect(JSON.stringify(graph)).toBe(original);
	});

	it("requires an explicit retained replay boundary for a nested checkpoint", () => {
		expect(() => scopeWorkflowFlowData(nestedCheckpointGraph(), "trigger", "pipeline::step::materialize"))
			.toThrow(/requires an explicit startFromNodeId/u);
		expect(() => scopeWorkflowFlowData(nestedCheckpointGraph(), "trigger", "pipeline::step::materialize", "after-pipeline"))
			.toThrow(/retained dependency ancestor/u);
		expect(() => scopeWorkflowFlowData(nestedCheckpointGraph(), "trigger", "pipeline::step::materialize", "segments")).not.toThrow();
	});
});
