import { describe, expect, it } from "vitest";
import {
	applyWorkflowAgentModelCutover,
	parseWorkflowInitiatingAgentExecution,
	resolveWorkflowAgentModelKey,
} from "./execution.agent-model-inheritance";

describe("workflow Agent model inheritance", () => {
	it("inherits the initiating Agent model when the workflow node does not pin one", () => {
		expect(resolveWorkflowAgentModelKey({
			flowVersionData: {
				workflowInitiatingAgentExecution: {
					model: "gpt-5.6-luna",
					apiStyle: "responses",
				},
			},
			configuredModelKey: null,
		})).toBe("gpt-5.6-luna");
	});

	it("uses an explicit node model only when no initiating Agent model was frozen", () => {
		expect(resolveWorkflowAgentModelKey({
			flowVersionData: { nodes: [], edges: [] },
			configuredModelKey: " gemini-3.1-pro ",
		})).toBe("gemini-3.1-pro");
		expect(resolveWorkflowAgentModelKey({
			flowVersionData: { nodes: [], edges: [] },
			configuredModelKey: null,
		})).toBe("");
	});

	it("records an explicit immutable model cutover without retaining the old active model", () => {
		const snapshot = applyWorkflowAgentModelCutover({
			nodes: [],
			edges: [],
			workflowInitiatingAgentExecution: {
				model: "deepseek-v4-flash",
				apiStyle: "chat",
			},
		}, {
			targetModelKey: "doubao-seed-2-0-lite-260428",
			apiStyle: "chat",
			authorizedBy: "user-1",
			authorizationSource: "admin",
			requestedAt: "2026-08-23T00:00:00.000Z",
		});

		expect(parseWorkflowInitiatingAgentExecution(snapshot)).toEqual({
			model: "doubao-seed-2-0-lite-260428",
			apiStyle: "chat",
		});
		expect(snapshot.workflowAgentModelCutovers).toEqual([{
			protocolVersion: "tapcanvas.workflow-agent-model-cutover/v1",
			from: { model: "deepseek-v4-flash", apiStyle: "chat" },
			to: { model: "doubao-seed-2-0-lite-260428", apiStyle: "chat" },
			authorizedBy: "user-1",
			authorizationSource: "admin",
			requestedAt: "2026-08-23T00:00:00.000Z",
			reason: "explicit_model_cutover",
		}]);
	});

	it("rejects an implicit no-op cutover", () => {
		expect(() => applyWorkflowAgentModelCutover({
			workflowInitiatingAgentExecution: {
				model: "doubao-seed-2-0-lite-260428",
				apiStyle: "chat",
			},
		}, {
			targetModelKey: "doubao-seed-2-0-lite-260428",
			apiStyle: "chat",
			authorizedBy: "user-1",
			authorizationSource: "initiating_agent",
			requestedAt: "2026-08-23T00:00:00.000Z",
		})).toThrow("target matches");
	});
});
