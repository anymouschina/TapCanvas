import { describe, expect, it } from "vitest";
import type { AgentPhysicalRunExitV1 } from "@tapcanvas/agent-observability";
import {
	projectPublicChatLogicalTaskState,
	projectWorkflowActionLogicalTaskState,
} from "./public-chat-logical-task-state";

const baseExit = {
	version: 1,
	logicalTaskId: "turn-1",
	taskNodeId: "root",
	taskRevision: 3,
	reasonCode: "test",
	exitedAt: "2026-08-30T00:00:00.000Z",
} as const;

describe("public chat logical task state", () => {
	it("commits a verified satisfied task", () => {
		const exit: AgentPhysicalRunExitV1 = {
			...baseExit,
			kind: "logical_terminal",
			taskStatus: "satisfied",
			continuationTicket: null,
		};
		expect(projectPublicChatLogicalTaskState({
			exit,
			expectedLogicalTaskId: "turn-1",
			deliveryVerified: true,
		})).toMatchObject({
			status: "succeeded",
			physicalRunStatus: "completed",
			deliveryStatus: "satisfied",
		});
	});

	it("refuses to commit success without delivery verification", () => {
		const exit: AgentPhysicalRunExitV1 = {
			...baseExit,
			kind: "logical_terminal",
			taskStatus: "satisfied",
			continuationTicket: null,
		};
		expect(() => projectPublicChatLogicalTaskState({
			exit,
			expectedLogicalTaskId: "turn-1",
			deliveryVerified: false,
		})).toThrow("missing verified delivery");
	});

	it("keeps a durable external wait distinct from a physical run", () => {
		const exit: AgentPhysicalRunExitV1 = {
			...baseExit,
			kind: "waiting_external",
			taskStatus: "waiting_for_evidence",
			continuationTicket: {
				version: 1,
				ticketId: "ticket-1",
				logicalTaskId: "turn-1",
				taskNodeId: "root",
				taskRevision: 3,
				resumeFromStatus: "waiting_for_evidence",
				nextTrigger: "external_evidence",
				reasonCode: "test",
				issuedAt: "2026-08-30T00:00:00.000Z",
			},
		};
		expect(projectPublicChatLogicalTaskState({
			exit,
			expectedLogicalTaskId: "turn-1",
			deliveryVerified: false,
		})).toMatchObject({
			status: "waiting_external",
			physicalRunStatus: "handed_off",
			deliveryStatus: "pending",
		});
	});

	it("keeps repair and replan handoffs logically active", () => {
		const exits: AgentPhysicalRunExitV1[] = [
			{
				...baseExit,
				kind: "handoff",
				taskStatus: "repair_required",
				continuationTicket: {
					version: 1,
					ticketId: "ticket-handoff",
					logicalTaskId: "turn-1",
					taskNodeId: "root",
					taskRevision: 3,
					resumeFromStatus: "repair_required",
					nextTrigger: "durable_resume",
					reasonCode: "test",
					issuedAt: "2026-08-30T00:00:00.000Z",
				},
			},
			{
				...baseExit,
				kind: "replan",
				taskStatus: "replan_required",
				continuationTicket: {
					version: 1,
					ticketId: "ticket-replan",
					logicalTaskId: "turn-1",
					taskNodeId: "root",
					taskRevision: 3,
					resumeFromStatus: "replan_required",
					nextTrigger: "durable_resume",
					reasonCode: "test",
					issuedAt: "2026-08-30T00:00:00.000Z",
				},
			},
		];
		for (const exit of exits) {
			expect(projectPublicChatLogicalTaskState({
				exit,
				expectedLogicalTaskId: "turn-1",
				deliveryVerified: false,
			})).toMatchObject({ status: "active", physicalRunStatus: "handed_off" });
		}
	});
});

describe("workflow action logical task state", () => {
	it("closes the atomic action without manufacturing a public delivery envelope", () => {
		const exit: AgentPhysicalRunExitV1 = {
			...baseExit,
			logicalTaskId: "workflow-turn-1",
			taskNodeId: "beat-sheet-agent",
			kind: "logical_terminal",
			taskStatus: "satisfied",
			continuationTicket: null,
		};

		expect(projectWorkflowActionLogicalTaskState({
			exit,
			expectedLogicalTaskId: "workflow-turn-1",
		})).toMatchObject({
			status: "succeeded",
			physicalRunStatus: "completed",
			deliveryStatus: "satisfied",
			taskNodeId: "beat-sheet-agent",
		});
	});
});
