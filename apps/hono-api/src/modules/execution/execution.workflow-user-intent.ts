import { verifyUserIntentContract } from "../task/video-orchestrator.user-intent-contract";
import { AppError } from "../../middleware/error";

function protocolError(code: string): AppError {
	return new AppError(code, { status: 400, code });
}

/** Execution-owned semantic payload. It is never authored in tool arguments. */
export const WORKFLOW_USER_INTENT_FIELD = "workflowUserIntent";

export type WorkflowUserIntent = Readonly<{
	version: 1;
	ownerId: string;
	contract: Record<string, unknown>;
}>;

export function freezeWorkflowUserIntent(input: Readonly<{
	ownerId: string;
	contract: unknown;
	expectedContractHash?: string;
}>): WorkflowUserIntent | null {
	if (input.contract === undefined) {
		if (input.expectedContractHash) throw protocolError("workflow_user_intent_payload_missing");
		return null;
	}
	const verified = verifyUserIntentContract(input.contract);
	if (!verified.ok) throw new AppError(verified.message, { status: 400, code: verified.code });
	const contract = verified.value.contract;
	if (input.expectedContractHash && input.expectedContractHash !== contract.contractHash) {
		throw protocolError("workflow_user_intent_provenance_mismatch");
	}
	const ownerId = input.ownerId.trim();
	if (!ownerId) throw protocolError("workflow_user_intent_owner_missing");
	return { version: 1, ownerId, contract };
}

export function readWorkflowUserIntent(value: unknown, ownerId: string): WorkflowUserIntent | null {
	if (value === undefined || value === null) return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw protocolError("workflow_user_intent_invalid");
	}
	const record = value as Record<string, unknown>;
	if (record.version !== 1 || record.ownerId !== ownerId || record.contract === undefined) {
		throw protocolError("workflow_user_intent_invalid");
	}
	return freezeWorkflowUserIntent({ ownerId, contract: record.contract });
}

/** Attach only the authenticated bridge's frozen contract, never model-authored arguments. */
export function bindWorkflowUserIntentToTrigger(input: Readonly<{
	ownerId: string;
	contract: unknown;
	expectedContractHash?: string;
	triggerPayload?: Record<string, unknown>;
	args: Record<string, unknown>;
}>): Record<string, unknown> | undefined {
	const reserved = ["userIntentContract", "userIntentContractHash", WORKFLOW_USER_INTENT_FIELD];
	if (reserved.some((key) => key in input.args || (input.triggerPayload && key in input.triggerPayload))) {
		throw protocolError("workflow_user_intent_machine_field_override");
	}
	if ((input.contract !== undefined) !== (input.expectedContractHash !== undefined)) {
		throw protocolError("workflow_user_intent_machine_fields_incomplete");
	}
	const frozen = freezeWorkflowUserIntent(input);
	return frozen ? { ...input.triggerPayload, [WORKFLOW_USER_INTENT_FIELD]: frozen } : input.triggerPayload;
}
