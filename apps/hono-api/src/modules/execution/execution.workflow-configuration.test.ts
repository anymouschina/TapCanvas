import { describe, expect, it } from "vitest";

import { materializeWorkflowConfigurationInheritance } from "./execution.workflow-configuration";

function workflowNode(
	nodeId: string,
	data: Record<string, unknown>,
): Record<string, unknown> {
	return {
		id: `workflow-1:${nodeId}`,
		data: {
			kind: "workflowStage",
			workflowInstanceId: "workflow-1",
			workflowNodeId: nodeId,
			...data,
		},
	};
}

describe("workflow configuration inheritance", () => {
	it("materializes one canonical media configuration into a variant branch", () => {
		const resolved = materializeWorkflowConfigurationInheritance([
			workflowNode("asset-image-generate", {
				workflowImageModelKey: "gpt-image-2",
				workflowImageAspectRatio: "16:9",
				workflowImageSize: "2K",
			}),
			workflowNode("launch-asset-image-generate", {
				workflowConfigurationSourceNodeId: "asset-image-generate",
			}),
			workflowNode("cost-estimate", {
				workflowVideoModelKey: "doubao-seedance-2.5",
				workflowVideoResolution: "480p",
				workflowVideoAspectRatio: "16:9",
			}),
			workflowNode("launch-cost-estimate", {
				workflowConfigurationSourceNodeId: "cost-estimate",
			}),
		]) as Array<{ data: Record<string, unknown> }>;

		expect(resolved[1]?.data).toMatchObject({
			workflowImageModelKey: "gpt-image-2",
			workflowImageAspectRatio: "16:9",
			workflowImageSize: "2K",
		});
		expect(resolved[3]?.data).toMatchObject({
			workflowVideoModelKey: "doubao-seedance-2.5",
			workflowVideoResolution: "480p",
			workflowVideoAspectRatio: "16:9",
		});
	});

	it("fails on a missing source or independently drifted copy", () => {
		expect(() => materializeWorkflowConfigurationInheritance([
			workflowNode("launch-cost-estimate", {
				workflowConfigurationSourceNodeId: "cost-estimate",
			}),
		])).toThrow("configuration source node is missing");

		expect(() => materializeWorkflowConfigurationInheritance([
			workflowNode("cost-estimate", {
				workflowVideoModelKey: "doubao-seedance-2.5",
			}),
			workflowNode("launch-cost-estimate", {
				workflowConfigurationSourceNodeId: "cost-estimate",
				workflowVideoModelKey: "doubao-seedance-2.0",
			}),
		])).toThrow("workflow configuration drift");
	});
});
