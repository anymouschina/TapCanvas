import {
	freezeWorkflowUserIntent,
	WORKFLOW_USER_INTENT_FIELD,
	type WorkflowUserIntent,
} from "./execution.workflow-user-intent";
import {
	freezeWorkflowActionableDeliverySource,
	WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD,
	WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_FIELD,
	WORKFLOW_ROOT_TASK_IDENTITY_FIELD,
	type WorkflowActionableDeliverySource,
} from "./execution.workflow-source-authority";
import { AppError } from "../../middleware/error";

const SERVER_OWNED_WORKFLOW_SOURCE_FIELDS = [
	WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD,
	WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_FIELD,
	WORKFLOW_ROOT_TASK_IDENTITY_FIELD,
	WORKFLOW_USER_INTENT_FIELD,
] as const;

function rejectModelSuppliedSourceAuthority(
	modelArgs: Readonly<Record<string, unknown>>,
	triggerPayload: Readonly<Record<string, unknown>> | undefined,
): void {
	for (const field of SERVER_OWNED_WORKFLOW_SOURCE_FIELDS) {
		if (Object.prototype.hasOwnProperty.call(modelArgs, field)
			|| (triggerPayload && Object.prototype.hasOwnProperty.call(triggerPayload, field))) {
			throw new AppError(`${field} is server-owned`, {
				status: 400,
				code: "workflow_source_authority_reserved",
			});
		}
	}
}

/**
 * Project the authenticated Agent envelope into a new workflow snapshot.
 * Callers must resolve an existing idempotent receipt before invoking this:
 * retries return that immutable receipt even if the current envelope changed.
 */
export function projectWorkflowStartSourceEnvelope(input: Readonly<{
	ownerId: string;
	modelArgs: Readonly<Record<string, unknown>>;
	triggerPayload: Record<string, unknown> | undefined;
	parentUserIntentContract: unknown;
	parentDeliveryReference: unknown;
	expectedContractHash?: string;
}>): Readonly<{
	workflowUserIntent: WorkflowUserIntent | null;
	actionableDeliverySource: WorkflowActionableDeliverySource | null;
	triggerPayload: Record<string, unknown> | undefined;
}> {
	rejectModelSuppliedSourceAuthority(input.modelArgs, input.triggerPayload);
	const workflowUserIntent = freezeWorkflowUserIntent({
		ownerId: input.ownerId,
		contract: input.parentUserIntentContract,
		expectedContractHash: input.expectedContractHash,
	});
	const actionableDeliverySource = freezeWorkflowActionableDeliverySource({
		ownerId: input.ownerId,
		userIntentContract: workflowUserIntent?.contract,
		parentDeliveryReference: input.parentDeliveryReference,
	});
	if (!workflowUserIntent && !actionableDeliverySource) {
		return {
			workflowUserIntent,
			actionableDeliverySource,
			triggerPayload: input.triggerPayload,
		};
	}
	const triggerPayload: Record<string, unknown> = {
		...(input.triggerPayload ?? {}),
		...(workflowUserIntent ? { [WORKFLOW_USER_INTENT_FIELD]: workflowUserIntent } : {}),
		...(actionableDeliverySource
			? { [WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_FIELD]: actionableDeliverySource }
			: {}),
	};
	return { workflowUserIntent, actionableDeliverySource, triggerPayload };
}
