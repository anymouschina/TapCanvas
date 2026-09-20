import { sha256Hex } from "../asset/book-content-hash";

export const WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD = "workflowAcceptedTurnSource";
export const WORKFLOW_ACCEPTED_TURN_SOURCE_PROTOCOL = "tapcanvas.workflow-accepted-turn-source/v1";

export type WorkflowAcceptedTurnSource = Readonly<{
	protocolVersion: typeof WORKFLOW_ACCEPTED_TURN_SOURCE_PROTOCOL;
	kind: "public_chat_turn";
	ownerId: string;
	sourceId: string;
	text: string;
	fingerprint: string;
}>;

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function createWorkflowAcceptedTurnSource(input: Readonly<{
	ownerId: string;
	sourceId: string;
	text: string;
}>): WorkflowAcceptedTurnSource {
	const ownerId = input.ownerId.trim();
	const sourceId = input.sourceId.trim();
	const text = input.text.trim();
	if (!ownerId || !sourceId || !text) {
		throw new Error("workflow_accepted_turn_source_required");
	}
	return {
		protocolVersion: WORKFLOW_ACCEPTED_TURN_SOURCE_PROTOCOL,
		kind: "public_chat_turn",
		ownerId,
		sourceId,
		text,
		fingerprint: sha256Hex(text),
	};
}

export function parseWorkflowAcceptedTurnSource(
	value: unknown,
	expectedOwnerId: string,
): WorkflowAcceptedTurnSource | null {
	if (value === undefined || value === null) return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("workflow_accepted_turn_source_invalid");
	}
	const record = value as Record<string, unknown>;
	const ownerId = readString(record.ownerId);
	const sourceId = readString(record.sourceId);
	const text = readString(record.text);
	const fingerprint = readString(record.fingerprint);
	if (
		record.protocolVersion !== WORKFLOW_ACCEPTED_TURN_SOURCE_PROTOCOL
		|| record.kind !== "public_chat_turn"
		|| !ownerId
		|| ownerId !== expectedOwnerId.trim()
		|| !sourceId
		|| !text
		|| fingerprint !== sha256Hex(text)
	) {
		throw new Error("workflow_accepted_turn_source_invalid");
	}
	return {
		protocolVersion: WORKFLOW_ACCEPTED_TURN_SOURCE_PROTOCOL,
		kind: "public_chat_turn",
		ownerId,
		sourceId,
		text,
		fingerprint,
	};
}

/** Host-owned task identity, independent of the workflow's narrative source. */
export const WORKFLOW_ROOT_TASK_IDENTITY_FIELD = "workflowRootTaskIdentity";
export type WorkflowRootTaskIdentity = Readonly<{
	version: 1;
	ownerId: string;
	logicalTaskBudgetRootId: string;
}>;
export function parseWorkflowRootTaskIdentity(value: unknown, expectedOwnerId: string): WorkflowRootTaskIdentity | null {
	if (value === undefined || value === null) return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workflow_root_task_identity_invalid");
	const record = value as Record<string, unknown>;
	const ownerId = readString(record.ownerId);
	const logicalTaskBudgetRootId = readString(record.logicalTaskBudgetRootId);
	if (record.version !== 1 || !ownerId || ownerId !== expectedOwnerId.trim() || !logicalTaskBudgetRootId) {
		throw new Error("workflow_root_task_identity_invalid");
	}
	return { version: 1, ownerId, logicalTaskBudgetRootId };
}
