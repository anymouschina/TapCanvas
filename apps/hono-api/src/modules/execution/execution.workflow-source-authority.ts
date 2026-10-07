import { sha256Hex } from "../asset/book-content-hash";
import { AppError } from "../../middleware/error";

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

export const WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_FIELD = "workflowActionableDeliverySource";
export const WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_PROTOCOL = "tapcanvas.workflow-actionable-delivery-source/v1";

export type ActionableDeliverySourceReference = Readonly<{
	mode: "actionable";
	version: 1;
	referenceId: string;
	publicTurnId: string;
	deliveredAt: string;
	content: string;
	contentHash: string;
	artifactKind?: string;
	label?: string;
	summary?: string;
	originalUserRequest?: string;
	sourceContractHash?: string;
}>;

/**
 * Owner-scoped copy of the runtime-selected delivery reference. Its SHA-256
 * validates exact body integrity; it does not attest that a durable historical
 * delivery receipt exists.
 */
export type WorkflowActionableDeliverySource = Readonly<{
	protocolVersion: typeof WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_PROTOCOL;
	sourceType: "actionable_delivery";
	ownerId: string;
	reference: ActionableDeliverySourceReference;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized && normalized.length <= maxLength ? normalized : null;
}

function validateActionableDeliverySourceReference(value: unknown): ActionableDeliverySourceReference | null {
	if (!isRecord(value) || value.mode !== "actionable" || value.version !== 1) return null;
	const referenceId = boundedString(value.referenceId, 512);
	const publicTurnId = boundedString(value.publicTurnId, 240);
	const deliveredAt = boundedString(value.deliveredAt, 80);
	const content = typeof value.content === "string" && value.content.trim() ? value.content : null;
	const contentHash = boundedString(value.contentHash, 80);
	if (!referenceId || !publicTurnId || !deliveredAt || !content || !contentHash
		|| contentHash !== `sha256:${sha256Hex(content)}`) return null;
	for (const field of ["artifactKind", "label", "summary", "originalUserRequest", "sourceContractHash"] as const) {
		if (value[field] !== undefined && typeof value[field] !== "string") return null;
	}
	return {
		mode: "actionable",
		version: 1,
		referenceId,
		publicTurnId,
		deliveredAt,
		content,
		contentHash,
		...(typeof value.artifactKind === "string" ? { artifactKind: value.artifactKind } : {}),
		...(typeof value.label === "string" ? { label: value.label } : {}),
		...(typeof value.summary === "string" ? { summary: value.summary } : {}),
		...(typeof value.originalUserRequest === "string" ? { originalUserRequest: value.originalUserRequest } : {}),
		...(typeof value.sourceContractHash === "string" ? { sourceContractHash: value.sourceContractHash } : {}),
	};
}

/**
 * Bind a workflow source only to the reference explicitly frozen by the
 * parent intent. This is called by source-producing workflow start actions,
 * never by read-only tools or ordinary new-task/continuation calls.
 */
export function freezeWorkflowActionableDeliverySource(input: Readonly<{
	ownerId: string;
	userIntentContract: unknown;
	parentDeliveryReference: unknown;
}>): WorkflowActionableDeliverySource | null {
	const contract = isRecord(input.userIntentContract) ? input.userIntentContract : null;
	const resolution = contract && isRecord(contract.referenceResolution) ? contract.referenceResolution : null;
	const mode = resolution?.mode;
	const selected = mode === "selected_exact" || mode === "derived";
	if (!selected) {
		if (input.parentDeliveryReference !== undefined && input.parentDeliveryReference !== null) {
			throw new AppError("workflow_actionable_delivery_reference_unselected", {
				status: 400,
				code: "workflow_actionable_delivery_reference_unselected",
			});
		}
		return null;
	}
	const referenceId = boundedString(resolution?.referenceId, 512);
	if (!referenceId) {
		throw new AppError("workflow_actionable_delivery_reference_resolution_invalid", {
			status: 400,
			code: "workflow_actionable_delivery_reference_resolution_invalid",
		});
	}
	if (input.parentDeliveryReference === undefined || input.parentDeliveryReference === null) {
		throw new AppError("workflow_actionable_delivery_source_missing", {
			status: 400,
			code: "workflow_actionable_delivery_source_missing",
			details: { referenceId },
		});
	}
	const reference = validateActionableDeliverySourceReference(input.parentDeliveryReference);
	if (!reference) {
		throw new AppError("workflow_actionable_delivery_source_invalid", {
			status: 400,
			code: "workflow_actionable_delivery_source_invalid",
			details: { referenceId },
		});
	}
	if (reference.referenceId !== referenceId) {
		throw new AppError("workflow_actionable_delivery_reference_mismatch", {
			status: 400,
			code: "workflow_actionable_delivery_reference_mismatch",
			details: { expectedReferenceId: referenceId, receivedReferenceId: reference.referenceId },
		});
	}
	const ownerId = input.ownerId.trim();
	if (!ownerId) throw new AppError("workflow_actionable_delivery_owner_missing", { status: 400, code: "workflow_actionable_delivery_owner_missing" });
	return {
		protocolVersion: WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_PROTOCOL,
		sourceType: "actionable_delivery",
		ownerId,
		reference,
	};
}

export function parseWorkflowActionableDeliverySource(
	value: unknown,
	expectedOwnerId: string,
): WorkflowActionableDeliverySource | null {
	if (value === undefined || value === null) return null;
	if (!isRecord(value) || value.protocolVersion !== WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_PROTOCOL
		|| value.sourceType !== "actionable_delivery" || value.ownerId !== expectedOwnerId.trim()) {
		throw new Error("workflow_actionable_delivery_source_invalid");
	}
	const reference = validateActionableDeliverySourceReference(value.reference);
	if (!reference) throw new Error("workflow_actionable_delivery_source_invalid");
	return {
		protocolVersion: WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_PROTOCOL,
		sourceType: "actionable_delivery",
		ownerId: value.ownerId,
		reference,
	};
}

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
