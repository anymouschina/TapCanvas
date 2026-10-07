import { describe, expect, it } from "vitest";
import { resolveWorkflowAgentReasoningEffort } from "./execution.agent-model-inheritance";
import {
	applyReasoningCeiling,
	resolveAuthorReasoningCeiling,
	resolveWorkflowAgentDefaultReasoningEffort,
	WORKFLOW_AGENT_DEFAULT_REASONING_EFFORT,
} from "./execution.reasoning-ceiling";

describe("workflow agent reasoning effort", () => {
	it("defaults to low when nobody chose an effort", () => {
		expect(WORKFLOW_AGENT_DEFAULT_REASONING_EFFORT).toBe("low");
		expect(resolveWorkflowAgentDefaultReasoningEffort({})).toBe("low");
		expect(resolveWorkflowAgentDefaultReasoningEffort({ WORKFLOW_AGENT_REASONING_DEFAULT: "medium" })).toBe("medium");
		expect(resolveWorkflowAgentDefaultReasoningEffort({ WORKFLOW_AGENT_REASONING_DEFAULT: "junk" })).toBe("low");
		expect(resolveWorkflowAgentDefaultReasoningEffort({ WORKFLOW_AGENT_REASONING_DEFAULT: "off" })).toBeUndefined();
	});

	it("follows the initiating AI chat turn first", () => {
		expect(resolveWorkflowAgentReasoningEffort({
			flowVersionData: {
				workflowInitiatingAgentExecution: { model: "deepseek-v4.1-flash", apiStyle: "chat", reasoningEffort: "high" },
				workflowDirectAgentModelSelection: { model: "deepseek-v4.1-flash", source: "user_preference", reasoningEffort: "low" },
			},
			configuredEffort: "medium",
		})).toBe("high");
	});

	it("follows the effort picked next to the model when launched directly", () => {
		expect(resolveWorkflowAgentReasoningEffort({
			flowVersionData: { workflowDirectAgentModelSelection: { model: "deepseek-v4.1-flash", source: "user_preference", reasoningEffort: "high" } },
			configuredEffort: "medium",
		})).toBe("high");
	});

	it("falls back to node configuration, then to nothing so the default applies", () => {
		const direct = { workflowDirectAgentModelSelection: { model: "deepseek-v4.1-flash", source: "user_preference" } };
		expect(resolveWorkflowAgentReasoningEffort({ flowVersionData: direct, configuredEffort: "medium" })).toBe("medium");
		expect(resolveWorkflowAgentReasoningEffort({ flowVersionData: direct })).toBeUndefined();
		// An initiating turn without an explicit effort does not mask later choices.
		expect(resolveWorkflowAgentReasoningEffort({
			flowVersionData: { workflowInitiatingAgentExecution: { model: "deepseek-v4.1-flash", apiStyle: "chat" } },
			configuredEffort: "minimal",
		})).toBe("minimal");
		expect(resolveWorkflowAgentReasoningEffort({
			flowVersionData: { workflowDirectAgentModelSelection: { model: "m", source: "user_preference", reasoningEffort: "bogus" } },
		})).toBeUndefined();
	});

	it("never lets a deployment default override an explicit user choice", () => {
		const chosen = resolveWorkflowAgentReasoningEffort({
			flowVersionData: { workflowInitiatingAgentExecution: { model: "deepseek-v4.1-flash", apiStyle: "chat", reasoningEffort: "xhigh" } },
		}) ?? resolveWorkflowAgentDefaultReasoningEffort({});
		expect(applyReasoningCeiling(chosen, resolveAuthorReasoningCeiling({}))).toBe("xhigh");
	});
});

describe("explicit node reasoning ceiling", () => {
	it("applies only when the node data declares one", () => {
		expect(resolveAuthorReasoningCeiling({})).toBeUndefined();
		expect(resolveAuthorReasoningCeiling({ nodeCeiling: "low" })).toBe("low");
		expect(resolveAuthorReasoningCeiling({ nodeCeiling: "bogus" })).toBeUndefined();
	});

	it("takes the lower of the chosen effort and the ceiling", () => {
		expect(applyReasoningCeiling("medium", "none")).toBe("none");
		expect(applyReasoningCeiling("high", "low")).toBe("low");
		expect(applyReasoningCeiling("none", "low")).toBe("none");
		expect(applyReasoningCeiling(undefined, "none")).toBe("none");
		expect(applyReasoningCeiling("medium", undefined)).toBe("medium");
		expect(applyReasoningCeiling(undefined, undefined)).toBeUndefined();
	});
});
