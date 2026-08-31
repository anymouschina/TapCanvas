import { describe, expect, it } from "vitest";

import { resolveWorkflowNodeExecutionModelKey } from "./execution.node-model-attribution";

describe("workflow node model attribution", () => {
	it("inherits the initiating chat model for an actual Workflow Agent call", () => {
		expect(resolveWorkflowNodeExecutionModelKey({
			executorRef: "agents.logical-task/v2",
			flowVersionData: {
				workflowInitiatingAgentExecution: { model: "gpt-current", apiStyle: "responses" },
			},
			nodeData: { workflowAgentModelKey: "deepseek-v4-flash" },
		})).toBe("gpt-current");
	});

	it("does not report a stale Agent model on a deterministic control node", () => {
		expect(resolveWorkflowNodeExecutionModelKey({
			executorRef: "video.asset-plans.project/v1",
			flowVersionData: {},
			nodeData: { workflowAgentModelKey: "deepseek-v4-flash" },
		})).toBeNull();
	});

	it("reports explicit image and video generation models only at their provider boundaries", () => {
		expect(resolveWorkflowNodeExecutionModelKey({
			executorRef: "tapcanvas.image.generate/v1",
			flowVersionData: {},
			nodeData: { workflowImageModelKey: "gpt-image-2" },
		})).toBe("gpt-image-2");
		expect(resolveWorkflowNodeExecutionModelKey({
			executorRef: "tapcanvas.video.generate/v1",
			flowVersionData: {},
			nodeData: { workflowVideoModelKey: "doubao-seedance-2.5" },
		})).toBe("doubao-seedance-2.5");
	});
});
