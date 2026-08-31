import { describe, expect, it } from "vitest";
import {
	evaluateWorkflowRecoveryAgentFence,
	evaluateWorkflowResumeFamilyGuard,
} from "./execution.resume-guard";

describe("workflow recovery family guard", () => {
	it("rejects a second recovery while the family already has active work", () => {
		expect(evaluateWorkflowResumeFamilyGuard("failed-2", {
			latestExecutionId: "failed-2",
			latestExecutionStatus: "failed",
			latestFailedExecutionId: "failed-2",
			activeExecutionCount: 1,
			activeExecutionIds: ["recovery-3"],
		})).toEqual({
			allowed: false,
			code: "workflow_resume_family_active",
			activeExecutionIds: ["recovery-3"],
		});
	});

	it("rejects recovery from an older failed family member", () => {
		expect(evaluateWorkflowResumeFamilyGuard("failed-1", {
			latestExecutionId: "failed-2",
			latestExecutionStatus: "failed",
			latestFailedExecutionId: "failed-2",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		})).toEqual({
			allowed: false,
			code: "workflow_resume_source_stale",
			latestExecutionId: "failed-2",
		});
	});

	it("allows only the latest inactive failed member to proceed", () => {
		expect(evaluateWorkflowResumeFamilyGuard("failed-2", {
			latestExecutionId: "failed-2",
			latestExecutionStatus: "failed",
			latestFailedExecutionId: "failed-2",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		})).toEqual({ allowed: true });
	});

	it("allows the latest failed member after a later recovery was canceled", () => {
		expect(evaluateWorkflowResumeFamilyGuard("failed-2", {
			latestExecutionId: "canceled-3",
			latestExecutionStatus: "canceled",
			latestFailedExecutionId: "failed-2",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		})).toEqual({ allowed: true });
	});

	it("does not let a canceled recovery reopen an older superseded failure", () => {
		expect(evaluateWorkflowResumeFamilyGuard("failed-1", {
			latestExecutionId: "canceled-3",
			latestExecutionStatus: "canceled",
			latestFailedExecutionId: "failed-2",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		})).toEqual({
			allowed: false,
			code: "workflow_resume_source_stale",
			latestExecutionId: "canceled-3",
		});
	});

	it("allows an explicitly selected failed checkpoint after later cancelled recoveries when external side effects are proven absent", () => {
		expect(evaluateWorkflowResumeFamilyGuard("failed-1", {
			latestExecutionId: "canceled-4",
			latestExecutionStatus: "canceled",
			latestFailedExecutionId: "failed-3",
			activeExecutionCount: 0,
			activeExecutionIds: [],
			historicalSourceReplaySafe: true,
		})).toEqual({ allowed: true });
	});

	it("allows an explicitly selected older failed checkpoint after a side-effect-free failed recovery", () => {
		expect(evaluateWorkflowResumeFamilyGuard("failed-1", {
			latestExecutionId: "failed-4",
			latestExecutionStatus: "failed",
			latestFailedExecutionId: "failed-4",
			activeExecutionCount: 0,
			activeExecutionIds: [],
			historicalSourceReplaySafe: true,
		})).toEqual({ allowed: true });
	});
});

describe("workflow recovery Agent fence guard", () => {
	it("allows recovery when every discovered source turn is confirmed inactive", () => {
		expect(evaluateWorkflowRecoveryAgentFence([
			{ status: "interrupted", errorCode: null },
			{ status: "already_inactive", errorCode: null },
		])).toEqual({ allowed: true });
	});

	it("rejects recovery when any cancellation plane is unconfirmed", () => {
		expect(evaluateWorkflowRecoveryAgentFence([
			{ status: "interrupted", errorCode: null },
			{ status: "failed", errorCode: "workflow_agent_turn_partial_interrupt" },
			{ status: "failed", errorCode: "workflow_agent_turn_partial_interrupt" },
		])).toEqual({
			allowed: false,
			code: "workflow_resume_agent_fence_failed",
			failedTargetCount: 2,
			errorCodes: ["workflow_agent_turn_partial_interrupt"],
		});
	});
});
