export const WORKFLOW_CONDITION_DECISION_VERSION = "workflow.condition-decision/v1" as const;
export const WORKFLOW_HUMAN_DECISION_VERSION = "workflow.human-decision/v1" as const;
export const WORKFLOW_TERMINAL_RECEIPT_VERSION = "workflow.terminal-receipt/v1" as const;

export type WorkflowConditionDecisionV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_CONDITION_DECISION_VERSION;
	matched: boolean;
	pointer: string;
	operator: "equals" | "not_equals" | "exists" | "is_true" | "is_false" | "greater_than" | "less_than";
	selectedValue: unknown;
}>;

export type WorkflowHumanDecisionV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_HUMAN_DECISION_VERSION;
	status: "approved" | "rejected";
	approved: boolean;
	respondedAt: string | null;
	respondedBy: string | null;
}>;

export type WorkflowTerminalReceiptV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_TERMINAL_RECEIPT_VERSION;
	outcome: "succeeded" | "failed";
	message: string;
	value: unknown;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Workflow control ${field} must be a non-empty string`);
	}
	return value.trim();
}

function nullableText(value: unknown, field: string): string | null {
	if (value === null) return null;
	return requireText(value, field);
}

export function parseWorkflowConditionDecisionV1(value: unknown): WorkflowConditionDecisionV1 {
	if (!isRecord(value) || value.protocolVersion !== WORKFLOW_CONDITION_DECISION_VERSION) {
		throw new Error(`Workflow condition decision protocolVersion must be ${WORKFLOW_CONDITION_DECISION_VERSION}`);
	}
	const operators: readonly WorkflowConditionDecisionV1["operator"][] = [
		"equals", "not_equals", "exists", "is_true", "is_false", "greater_than", "less_than",
	];
	if (typeof value.matched !== "boolean" || !operators.includes(value.operator as WorkflowConditionDecisionV1["operator"])) {
		throw new Error("Workflow condition decision has invalid matched or operator fields");
	}
	if (typeof value.pointer !== "string" || (value.pointer !== "" && !value.pointer.startsWith("/"))) {
		throw new Error("Workflow condition decision pointer must be empty or start with /");
	}
	return {
		protocolVersion: WORKFLOW_CONDITION_DECISION_VERSION,
		matched: value.matched,
		pointer: value.pointer,
		operator: value.operator as WorkflowConditionDecisionV1["operator"],
		selectedValue: value.selectedValue,
	};
}

export function parseWorkflowHumanDecisionV1(value: unknown): WorkflowHumanDecisionV1 {
	if (!isRecord(value) || value.protocolVersion !== WORKFLOW_HUMAN_DECISION_VERSION) {
		throw new Error(`Workflow human decision protocolVersion must be ${WORKFLOW_HUMAN_DECISION_VERSION}`);
	}
	if (value.status !== "approved" && value.status !== "rejected") {
		throw new Error("Workflow human decision status must be approved or rejected");
	}
	if (typeof value.approved !== "boolean" || value.approved !== (value.status === "approved")) {
		throw new Error("Workflow human decision approved flag must match status");
	}
	return {
		protocolVersion: WORKFLOW_HUMAN_DECISION_VERSION,
		status: value.status,
		approved: value.approved,
		respondedAt: nullableText(value.respondedAt, "respondedAt"),
		respondedBy: nullableText(value.respondedBy, "respondedBy"),
	};
}

export function parseWorkflowTerminalReceiptV1(value: unknown): WorkflowTerminalReceiptV1 {
	if (!isRecord(value) || value.protocolVersion !== WORKFLOW_TERMINAL_RECEIPT_VERSION) {
		throw new Error(`Workflow terminal receipt protocolVersion must be ${WORKFLOW_TERMINAL_RECEIPT_VERSION}`);
	}
	if (value.outcome !== "succeeded" && value.outcome !== "failed") {
		throw new Error("Workflow terminal receipt outcome must be succeeded or failed");
	}
	return {
		protocolVersion: WORKFLOW_TERMINAL_RECEIPT_VERSION,
		outcome: value.outcome,
		message: requireText(value.message, "terminal message"),
		value: value.value,
	};
}
