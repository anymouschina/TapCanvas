import { describe, expect, it } from "vitest";
import {
	deriveWorkflowPipelinePortArtifactContractV1,
	parseWorkflowPipelineRunSpec,
	WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
} from "./inline-pipeline";

type JsonRecord = Record<string, unknown>;

function nodeSnapshot(input: Readonly<{
	id: string;
	inputPorts: readonly string[];
	outputPorts: readonly string[];
	optionalInputPorts?: readonly string[];
	inputArtifactTypes?: Readonly<Record<string, readonly string[]>>;
	outputArtifactTypes?: Readonly<Record<string, readonly string[]>>;
}>): JsonRecord {
	return {
		id: input.id,
		type: "taskNode",
		kind: "workflowStage",
		data: {
			kind: "workflowStage",
			workflowNodeId: input.id,
			workflowNodeKind: input.id,
			workflowInputPorts: [...input.inputPorts],
			workflowOutputPorts: [...input.outputPorts],
			workflowAtomicSpec: {
				version: 1,
				category: "control",
				operation: input.id,
				executorRef: `test.${input.id}/v1`,
				executionMode: "once",
				inputPorts: [...input.inputPorts],
				...(input.optionalInputPorts ? { optionalInputPorts: input.optionalInputPorts } : {}),
				outputPorts: [...input.outputPorts],
				...(input.inputArtifactTypes ? { inputArtifactTypes: input.inputArtifactTypes } : {}),
				...(input.outputArtifactTypes ? { outputArtifactTypes: input.outputArtifactTypes } : {}),
			},
		},
	};
}

function validSpec(): JsonRecord {
	return {
		protocolVersion: WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
		inputs: [
			{
				portId: "source-segments",
				mode: "collection",
				artifactTypes: ["tapcanvas.clip-source-segments/v1"],
				itemArtifactTypes: ["tapcanvas.clip-source-segment/v1"],
			},
			{ portId: "trigger", mode: "value", artifactTypes: [] },
		],
		steps: [
			{
				stepId: "author",
				node: nodeSnapshot({
					id: "author",
					inputPorts: ["clip-segment", "trigger", "feedback"],
					optionalInputPorts: ["feedback"],
					outputPorts: ["packet"],
					inputArtifactTypes: { "clip-segment": ["tapcanvas.clip-source-segment/v1"] },
					outputArtifactTypes: { packet: ["tapcanvas.clip-production-packet/v1"] },
				}),
			},
			{
				stepId: "collect",
				node: nodeSnapshot({
					id: "collect",
					inputPorts: ["packets", "segments"],
					outputPorts: ["production"],
					inputArtifactTypes: {
						packets: ["tapcanvas.clip-production-packet/v1"],
						segments: ["tapcanvas.clip-source-segments/v1"],
					},
					outputArtifactTypes: { production: ["tapcanvas.clip-production-packets/v1"] },
				}),
			},
		],
		bindings: [
			{ from: { kind: "input", portId: "source-segments" }, to: { stepId: "author", portId: "clip-segment" }, mode: "value" },
			{ from: { kind: "input", portId: "trigger" }, to: { stepId: "author", portId: "trigger" }, mode: "value" },
			{ from: { kind: "step", stepId: "author", portId: "packet" }, to: { stepId: "collect", portId: "packets" }, mode: "collection" },
			{ from: { kind: "input", portId: "source-segments" }, to: { stepId: "collect", portId: "segments" }, mode: "collection" },
		],
		outputs: [{ portId: "clip-production", from: { stepId: "collect", portId: "production" }, mode: "value" }],
	};
}

describe("Workflow inline pipeline protocol", () => {
	it("parses and freezes an item-scoped graph with scalar-to-singleton-collection adapters", () => {
		const parsed = parseWorkflowPipelineRunSpec(validSpec());
		expect(parsed.bindings[2]?.mode).toBe("collection");
		expect(parsed.bindings[3]?.mode).toBe("collection");
		expect(parsed.inputs[0]?.itemArtifactTypes).toEqual(["tapcanvas.clip-source-segment/v1"]);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.steps[0]?.node.data.workflowAtomicSpec)).toBe(true);
		expect(() => { (parsed.steps[0]?.node.data as JsonRecord).label = "mutated"; }).toThrow();
	});

	it("derives the generic executor's typed boundary from declared input and output mappings", () => {
		expect(deriveWorkflowPipelinePortArtifactContractV1(validSpec())).toEqual({
			inputArtifactTypes: { "source-segments": ["tapcanvas.clip-source-segments/v1"] },
			outputArtifactTypes: { "clip-production": ["tapcanvas.clip-production-packets/v1"] },
		});
	});

	it("rejects an unbound required port, incompatible artifacts, cycles and unknown references", () => {
		const missingInput = validSpec();
		(missingInput.bindings as unknown[]).pop();
		expect(() => parseWorkflowPipelineRunSpec(missingInput)).toThrow("required input collect.segments");

		const incompatible = validSpec();
		const inputs = incompatible.inputs as JsonRecord[];
		const sourceInput = inputs[0];
		if (sourceInput) sourceInput.itemArtifactTypes = ["tapcanvas.invalid-segment/v1"];
		expect(() => parseWorkflowPipelineRunSpec(incompatible)).toThrow("artifact types do not match");

		const cyclic = validSpec();
		(cyclic.bindings as unknown[]).push({
			from: { kind: "step", stepId: "collect", portId: "production" },
			to: { stepId: "author", portId: "feedback" },
			mode: "value",
		});
		expect(() => parseWorkflowPipelineRunSpec(cyclic)).toThrow("acyclic graph");
	});
});
