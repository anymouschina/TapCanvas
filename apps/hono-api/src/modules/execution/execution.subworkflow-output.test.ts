import { describe, expect, it } from "vitest";
import {
	projectWorkflowSubworkflowOutput,
	type ProjectWorkflowSubworkflowOutputInput,
} from "./execution.subworkflow-output";

const selection = {
	nodeId: "child-terminal",
	portId: "result",
	artifactType: "tapcanvas.clip-prompts/v2",
} as const;

const lineage = [
	{ nodeId: "clips", portId: "items", itemId: "clip-04", index: 3 },
	{ nodeId: "split", portId: "clips", itemId: "source-02", index: 1 },
] as const;

function outputRefs(input: Readonly<{
	nodeId?: string;
	ports?: Readonly<Record<string, unknown>>;
	artifacts?: readonly Readonly<{ type: string; identity: string | null; value?: unknown }>[];
}> = {}) {
	return {
		protocolVersion: "1",
		executorRef: "workflow.artifact.contract/v1",
		nodeId: input.nodeId ?? "child-terminal",
		executionMode: "once",
		ports: input.ports ?? { result: { prompt: "clip prompt" } },
		artifacts: input.artifacts ?? [{
			type: "tapcanvas.clip-prompts/v2",
			identity: "artifact-clip-04",
			value: { prompt: "clip prompt" },
		}],
		evidence: {},
		itemRuns: [],
	};
}

function request(
	nodeRuns: ProjectWorkflowSubworkflowOutputInput["nodeRuns"],
): ProjectWorkflowSubworkflowOutputInput {
	return {
		childExecutionId: "child-execution-clip-04",
		childFlowVersionId: "child-version-frozen-7",
		selection,
		lineage,
		nodeRuns,
	};
}

describe("projectWorkflowSubworkflowOutput", () => {
	it("projects the explicit port and artifact while preserving child identity and item lineage", () => {
		const result = projectWorkflowSubworkflowOutput(request([
			{ nodeId: "unrelated-node", status: "success", outputRefs: outputRefs({ nodeId: "unrelated-node" }) },
			{ nodeId: "child-terminal", status: "success", outputRefs: outputRefs() },
		]));

		expect(result).toEqual({
			protocolVersion: "workflow.subworkflow-output-projection/v1",
			childExecutionId: "child-execution-clip-04",
			childFlowVersionId: "child-version-frozen-7",
			selection,
			lineage,
			value: { prompt: "clip prompt" },
			artifact: {
				type: "tapcanvas.clip-prompts/v2",
				identity: "artifact-clip-04",
				value: { prompt: "clip prompt" },
			},
		});
	});

	it("fails when the selected node run is absent or ambiguous", () => {
		expect(() => projectWorkflowSubworkflowOutput(request([])))
			.toThrow("has no frozen node run");
		const duplicate = { nodeId: "child-terminal", status: "success", outputRefs: outputRefs() } as const;
		expect(() => projectWorkflowSubworkflowOutput(request([duplicate, duplicate])))
			.toThrow("expected exactly one");
	});

	it("fails when the selected node run is not successful or its output node identity differs", () => {
		expect(() => projectWorkflowSubworkflowOutput(request([
			{ nodeId: "child-terminal", status: "failed", outputRefs: outputRefs() },
		])))
			.toThrow("status failed; expected success");
		expect(() => projectWorkflowSubworkflowOutput(request([
			{ nodeId: "child-terminal", status: "success", outputRefs: outputRefs({ nodeId: "other-node" }) },
		])))
			.toThrow("node identity mismatch");
	});

	it("fails when the selected output port is absent or empty", () => {
		expect(() => projectWorkflowSubworkflowOutput(request([
			{ nodeId: "child-terminal", status: "success", outputRefs: outputRefs({ ports: { other: "value" } }) },
		])))
			.toThrow("has no output port result");
		expect(() => projectWorkflowSubworkflowOutput(request([
			{ nodeId: "child-terminal", status: "success", outputRefs: outputRefs({ ports: { result: null } }) },
		])))
			.toThrow("has no materialized value");
	});

	it("fails when the requested artifact type is missing or ambiguous", () => {
		expect(() => projectWorkflowSubworkflowOutput(request([
			{
				nodeId: "child-terminal",
				status: "success",
				outputRefs: outputRefs({ artifacts: [{ type: "tapcanvas.image/v1", identity: "image-1", value: "https://assets.example/image.png" }] }),
			},
		])))
			.toThrow("no artifact of type tapcanvas.clip-prompts/v2; available types: tapcanvas.image/v1");
		expect(() => projectWorkflowSubworkflowOutput(request([
			{
				nodeId: "child-terminal",
				status: "success",
				outputRefs: outputRefs({ artifacts: [
					{ type: "tapcanvas.clip-prompts/v2", identity: "artifact-1", value: "first" },
					{ type: "tapcanvas.clip-prompts/v2", identity: "artifact-2", value: "second" },
				] }),
			},
		])))
			.toThrow("has 2 artifacts of type tapcanvas.clip-prompts/v2; expected exactly one");
	});

	it("fails when the matching typed artifact has no materialized identity, value, or media", () => {
		expect(() => projectWorkflowSubworkflowOutput(request([
			{
				nodeId: "child-terminal",
				status: "success",
				outputRefs: outputRefs({ artifacts: [{ type: "tapcanvas.clip-prompts/v2", identity: null }] }),
			},
		])))
			.toThrow("has no materialized identity, value, or media");
	});
});
