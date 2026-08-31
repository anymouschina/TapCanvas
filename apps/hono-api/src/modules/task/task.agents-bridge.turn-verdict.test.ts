import { describe, expect, it } from "vitest";

import {
	buildAgentsBridgeTurnVerdict,
	classifyAgentsBridgeAdmissionStatus,
	normalizeAgentsPhysicalRunExitV1,
	projectAgentsBridgeRunOutcomeFromPhysicalExit,
	resolveAgentsBridgeTaskResultStatus,
} from "./task.agents-bridge";

describe("buildAgentsBridgeTurnVerdict", () => {
	it("projects the canonical request terminal without reinterpreting text or tool history", () => {
		expect(buildAgentsBridgeTurnVerdict({
			version: 1,
			terminal: true,
			status: "succeeded",
			reason: "delivery_verified",
		})).toEqual({ status: "satisfied", reasons: ["delivery_verified"] });
	});

	it.each(["needs_input", "suspended"] as const)(
		"projects %s as a non-terminal-delivery partial verdict",
		(status) => {
			expect(buildAgentsBridgeTurnVerdict({
				version: 1,
				terminal: true,
				status,
				reason: `task_${status}`,
			})).toEqual({ status: "partial", reasons: [`task_${status}`] });
		},
	);

	it("projects explicit failure as failed", () => {
		expect(buildAgentsBridgeTurnVerdict({
			version: 1,
			terminal: true,
			status: "failed",
			reason: "external_dependency_failed",
		})).toEqual({ status: "failed", reasons: ["external_dependency_failed"] });
	});
});

describe("resolveAgentsBridgeTaskResultStatus", () => {
	it.each([
		["succeeded", "succeeded"],
		["failed", "failed"],
		["suspended", "running"],
		["needs_input", "running"],
	] as const)("projects %s as TaskResult.%s", (terminalStatus, taskStatus) => {
		expect(resolveAgentsBridgeTaskResultStatus({
			version: 1,
			terminal: true,
			status: terminalStatus,
			reason: `task_${terminalStatus}`,
		})).toBe(taskStatus);
	});
});

describe("normalizeAgentsPhysicalRunExitV1", () => {
	it("accepts a structurally consistent durable handoff ticket", () => {
		const exit = normalizeAgentsPhysicalRunExitV1({
			version: 1,
			kind: "handoff",
			logicalTaskId: "turn-1",
			taskNodeId: "task-1",
			taskRevision: 7,
			taskStatus: "repair_required",
			reasonCode: "tool_progress_circuit_exhausted",
			exitedAt: "2026-08-14T00:00:00.000Z",
			continuationTicket: {
				version: 1,
				ticketId: "turn-1:task-1:7",
				logicalTaskId: "turn-1",
				taskNodeId: "task-1",
				taskRevision: 7,
				resumeFromStatus: "repair_required",
				nextTrigger: "durable_resume",
				reasonCode: "tool_progress_circuit_exhausted",
				issuedAt: "2026-08-14T00:00:00.000Z",
			},
		});
		expect(exit?.continuationTicket?.ticketId).toBe("turn-1:task-1:7");
	});

	it("accepts a replan ticket without treating budget exhaustion as failure", () => {
		const exit = normalizeAgentsPhysicalRunExitV1({
			version: 1,
			kind: "replan",
			logicalTaskId: "turn-replan",
			taskNodeId: "task-replan",
			taskRevision: 8,
			taskStatus: "replan_required",
			reasonCode: "root_physical_execution_budget_exhausted",
			exitedAt: "2026-08-14T00:00:00.000Z",
			continuationTicket: {
				version: 1,
				ticketId: "turn-replan:task-replan:8",
				logicalTaskId: "turn-replan",
				taskNodeId: "task-replan",
				taskRevision: 8,
				resumeFromStatus: "replan_required",
				nextTrigger: "durable_resume",
				reasonCode: "root_physical_execution_budget_exhausted",
				issuedAt: "2026-08-14T00:00:00.000Z",
			},
		});
		expect(exit?.kind).toBe("replan");
		expect(exit?.continuationTicket?.resumeFromStatus).toBe("replan_required");
	});

	it("accepts user cancellation as an explicit non-resumable logical terminal", () => {
		const exit = normalizeAgentsPhysicalRunExitV1({
			version: 1,
			kind: "logical_terminal",
			logicalTaskId: "turn-canceled",
			taskNodeId: "task-canceled",
			taskRevision: 3,
			taskStatus: "canceled",
			reasonCode: "user_canceled_chat_turn",
			exitedAt: "2026-08-14T00:00:00.000Z",
			continuationTicket: null,
		});
		expect(exit?.taskStatus).toBe("canceled");
		expect(projectAgentsBridgeRunOutcomeFromPhysicalExit(exit!)).toEqual({
			version: 1,
			terminal: true,
			status: "failed",
			reason: "user_canceled_chat_turn",
		});
	});

	it("projects every recoverable physical exit as suspended instead of trusting a local failure", () => {
		const exit = normalizeAgentsPhysicalRunExitV1({
			version: 1,
			kind: "replan",
			logicalTaskId: "turn-replan-authority",
			taskNodeId: "task-replan-authority",
			taskRevision: 9,
			taskStatus: "replan_required",
			reasonCode: "repeated_tool_failure_loop",
			exitedAt: "2026-08-14T00:00:00.000Z",
			continuationTicket: {
				version: 1,
				ticketId: "turn-replan-authority:task-replan-authority:9",
				logicalTaskId: "turn-replan-authority",
				taskNodeId: "task-replan-authority",
				taskRevision: 9,
				resumeFromStatus: "replan_required",
				nextTrigger: "durable_resume",
				reasonCode: "repeated_tool_failure_loop",
				issuedAt: "2026-08-14T00:00:00.000Z",
			},
		});
		expect(projectAgentsBridgeRunOutcomeFromPhysicalExit(exit!)).toEqual({
			version: 1,
			terminal: true,
			status: "suspended",
			reason: "repeated_tool_failure_loop",
		});
	});

	it("rejects a ticket whose identity or trigger contradicts the exit", () => {
		expect(normalizeAgentsPhysicalRunExitV1({
			version: 1,
			kind: "handoff",
			logicalTaskId: "turn-1",
			taskNodeId: "task-1",
			taskRevision: 7,
			taskStatus: "repair_required",
			reasonCode: "repair",
			exitedAt: "2026-08-14T00:00:00.000Z",
			continuationTicket: {
				version: 1,
				ticketId: "ticket-1",
				logicalTaskId: "another-turn",
				taskNodeId: "task-1",
				taskRevision: 7,
				resumeFromStatus: "repair_required",
				nextTrigger: "external_evidence",
				reasonCode: "repair",
				issuedAt: "2026-08-14T00:00:00.000Z",
			},
		})).toBeNull();
	});
});

describe("classifyAgentsBridgeAdmissionStatus", () => {
	it("proves acceptance only from the exact durable public turn identity", () => {
		expect(classifyAgentsBridgeAdmissionStatus({
			payload: {
				activeTurn: true,
				turn: {
					turnId: "public-turn-1",
					state: "running",
					finalResponse: null,
				},
			},
			publicTurnId: "public-turn-1",
			sessionId: "session-1",
			reconciledAt: "2026-08-14T00:00:00.000Z",
		}).receipt).toEqual({
			version: 1,
			acceptance: "accepted",
			publicTurnId: "public-turn-1",
			sessionId: "session-1",
			turnState: "running",
			activeTurn: true,
			reconciledAt: "2026-08-14T00:00:00.000Z",
		});
	});

	it("keeps acceptance unknown when status points at another turn", () => {
		expect(classifyAgentsBridgeAdmissionStatus({
			payload: {
				activeTurn: false,
				turn: { turnId: "newer-turn", state: "succeeded" },
			},
			publicTurnId: "timed-out-turn",
			sessionId: "session-1",
			reconciledAt: "2026-08-14T00:00:00.000Z",
		}).receipt.acceptance).toBe("unknown");
	});
});
