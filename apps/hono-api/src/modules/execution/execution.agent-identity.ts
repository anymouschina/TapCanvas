import { sha256Hex } from "../asset/book-content-hash";

const WORKFLOW_AGENT_TURN_ID_MAX_LENGTH = 160;
const WORKFLOW_AGENT_SESSION_KEY_MAX_LENGTH = 240;
const WORKFLOW_AGENT_TURN_ID_DIGEST_LENGTH = 32;

export type WorkflowAgentTurnRetryIdentity = Readonly<{
	physicalRetryOrdinal: number | null;
}>;

function retrySuffix(identity: WorkflowAgentTurnRetryIdentity): string {
	return identity.physicalRetryOrdinal === null
		? ""
		: `:physical-retry:${identity.physicalRetryOrdinal}`;
}

/**
 * Produces the bounded public turn identity used by the durable Agent runtime.
 *
 * Long workflow node ids commonly share a prefix and differ only in their
 * runtime item suffix. Truncating the right side therefore collapses distinct
 * collection items onto the same logical task. Preserve a readable prefix and
 * the physical-recovery suffix, while binding the complete untruncated base through a
 * 128-bit digest.
 */
export function workflowAgentPublicTurnId(input: Readonly<{
	executionId: string;
	nodeId: string;
}> & WorkflowAgentTurnRetryIdentity): string {
	const base = `workflow:${input.executionId}:${input.nodeId}`;
	const suffix = retrySuffix(input);
	const complete = `${base}${suffix}`;
	if (complete.length <= WORKFLOW_AGENT_TURN_ID_MAX_LENGTH) return complete;

	const digest = sha256Hex(base).slice(0, WORKFLOW_AGENT_TURN_ID_DIGEST_LENGTH);
	const digestMarker = `:${digest}`;
	const prefixLength = WORKFLOW_AGENT_TURN_ID_MAX_LENGTH
		- digestMarker.length
		- suffix.length;
	if (prefixLength <= 0) {
		throw new Error("Workflow Agent physical-recovery suffix exceeds the public turn identity boundary");
	}
	return `${base.slice(0, prefixLength)}${digestMarker}${suffix}`;
}

/**
 * Produces the bounded durable-session identity used by agents-cli.
 *
 * Collection item node ids can already approach the shared 240-character
 * observability boundary before a physical-recovery suffix is appended. Keep
 * the complete recovery identity visible, and bind the omitted
 * portion of an overlong base through the same deterministic digest strategy
 * used by public turn ids. This is an identity projection, not a fallback:
 * invalid or colliding workflow facts are never silently discarded.
 */
export function workflowAgentSessionKey(input: Readonly<{
	executionId: string;
	nodeId: string;
}> & WorkflowAgentTurnRetryIdentity): string {
	const base = `workflow:${input.executionId}:${input.nodeId}`;
	const suffix = retrySuffix(input);
	const complete = `${base}${suffix}`;
	if (complete.length <= WORKFLOW_AGENT_SESSION_KEY_MAX_LENGTH) return complete;

	const digest = sha256Hex(base).slice(0, WORKFLOW_AGENT_TURN_ID_DIGEST_LENGTH);
	const digestMarker = `:${digest}`;
	const prefixLength = WORKFLOW_AGENT_SESSION_KEY_MAX_LENGTH
		- digestMarker.length
		- suffix.length;
	if (prefixLength <= 0) {
		throw new Error("Workflow Agent physical-recovery suffix exceeds the durable session identity boundary");
	}
	return `${base.slice(0, prefixLength)}${digestMarker}${suffix}`;
}
