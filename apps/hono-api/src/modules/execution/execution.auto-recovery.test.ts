import { describe, expect, it } from "vitest";
import {
	decideWorkflowFamilyAutomaticRecovery,
	WORKFLOW_FAMILY_AUTOMATIC_EXECUTION_LIMIT,
} from "./execution.auto-recovery";

describe("decideWorkflowFamilyAutomaticRecovery", () => {
	it("continues a repairable pre-submit authoring failure in the same family", () => {
		expect(decideWorkflowFamilyAutomaticRecovery({
			executionStatus: "failed",
			failureStage: "agent_authoring",
			familyExecutionCount: 1,
			activeExecutionCount: 0,
		})).toEqual({ eligible: true, reason: "repairable_pre_submit_failure" });
	});

	it("never replays a paid media failure as a new family execution", () => {
		expect(decideWorkflowFamilyAutomaticRecovery({
			executionStatus: "failed",
			failureStage: "media_generation",
			familyExecutionCount: 1,
			activeExecutionCount: 0,
		})).toEqual({ eligible: false, reason: "failure_stage_not_replayable" });
	});

	it("stops after the bounded family execution budget", () => {
		expect(decideWorkflowFamilyAutomaticRecovery({
			executionStatus: "failed",
			failureStage: "assembly",
			familyExecutionCount: WORKFLOW_FAMILY_AUTOMATIC_EXECUTION_LIMIT,
			activeExecutionCount: 0,
		})).toEqual({ eligible: false, reason: "family_execution_budget_exhausted" });
	});
});
