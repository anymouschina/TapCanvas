import { describe, expect, it } from "vitest";
import {
	parseWorkflowConditionDecisionV1,
	parseWorkflowHumanDecisionV1,
	parseWorkflowTerminalReceiptV1,
} from "@tapcanvas/workflow-kernel-protocol";

describe("typed workflow control contracts", () => {
	it("parses versioned structural condition decisions", () => {
		expect(parseWorkflowConditionDecisionV1({
			protocolVersion: "workflow.condition-decision/v1",
			matched: true,
			pointer: "/ready",
			operator: "is_true",
			selectedValue: true,
		})).toEqual({
			protocolVersion: "workflow.condition-decision/v1",
			matched: true,
			pointer: "/ready",
			operator: "is_true",
			selectedValue: true,
		});
	});

	it("requires human status and approval facts to agree", () => {
		expect(parseWorkflowHumanDecisionV1({
			protocolVersion: "workflow.human-decision/v1",
			status: "approved",
			approved: true,
			respondedAt: "2026-08-14T00:00:00.000Z",
			respondedBy: "admin-1",
		})).toMatchObject({ status: "approved", approved: true });
		expect(() => parseWorkflowHumanDecisionV1({
			protocolVersion: "workflow.human-decision/v1",
			status: "rejected",
			approved: true,
			respondedAt: null,
			respondedBy: null,
		})).toThrow("must match status");
	});

	it("keeps explicit terminal outcome and delivered value in one receipt", () => {
		expect(parseWorkflowTerminalReceiptV1({
			protocolVersion: "workflow.terminal-receipt/v1",
			outcome: "succeeded",
			message: "delivered",
			value: { assetId: "asset-1" },
		})).toEqual({
			protocolVersion: "workflow.terminal-receipt/v1",
			outcome: "succeeded",
			message: "delivered",
			value: { assetId: "asset-1" },
		});
	});
});
