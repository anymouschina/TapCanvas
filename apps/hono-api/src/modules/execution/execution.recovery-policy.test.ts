import { describe, expect, it } from "vitest";
import {
	assertWorkflowExecutionRecoveryAllowed,
	resolveWorkflowExecutionRecoveryPolicy,
	WorkflowExecutionRecoveryPolicyError,
} from "./execution.recovery-policy";

function flow(policy?: unknown): Readonly<Record<string, unknown>> {
	return {
		nodes: [{
			id: "trigger",
			data: {
				kind: "workflowTrigger",
				...(policy === undefined ? {} : { workflowExecutionRecoveryPolicy: policy }),
			},
		}],
		edges: [],
	};
}

describe("workflow execution recovery policy", () => {
	it("keeps ordinary workflows recoverable when no policy is authored", () => {
		expect(resolveWorkflowExecutionRecoveryPolicy(flow(), "trigger")).toBe("recoverable");
		expect(() => assertWorkflowExecutionRecoveryAllowed(flow(), "trigger")).not.toThrow();
	});

	it("rejects every cross-execution recovery for a fresh-only workflow", () => {
		expect(() => assertWorkflowExecutionRecoveryAllowed(flow("fresh_only"), "trigger"))
			.toThrowError(WorkflowExecutionRecoveryPolicyError);
		expect(() => assertWorkflowExecutionRecoveryAllowed(JSON.stringify(flow("fresh_only")), "trigger"))
			.toThrowError(WorkflowExecutionRecoveryPolicyError);
	});

	it("rejects malformed authored policies instead of silently falling back", () => {
		expect(() => resolveWorkflowExecutionRecoveryPolicy(flow("resume_if_possible"), "trigger"))
			.toThrowError("workflowExecutionRecoveryPolicy must be recoverable or fresh_only");
	});
});
