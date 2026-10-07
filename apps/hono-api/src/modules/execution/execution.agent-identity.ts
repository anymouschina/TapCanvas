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
 * A physical retry changes its public turn id, never its durable session:
 * otherwise the node loses its persisted candidate and repair checkpoint.
 * Long collection identities remain distinct through the complete base digest.
 */
export function workflowAgentSessionKey(input: Readonly<{
	executionId: string;
	nodeId: string;
}> & WorkflowAgentTurnRetryIdentity): string {
	const base = `workflow:${input.executionId}:${input.nodeId}`;
	if (base.length <= WORKFLOW_AGENT_SESSION_KEY_MAX_LENGTH) return base;

	const digest = sha256Hex(base).slice(0, WORKFLOW_AGENT_TURN_ID_DIGEST_LENGTH);
	const digestMarker = `:${digest}`;
	const prefixLength = WORKFLOW_AGENT_SESSION_KEY_MAX_LENGTH
		- digestMarker.length;
	return `${base.slice(0, prefixLength)}${digestMarker}`;
}

/** Match an earlier physical generation by the same exact identity derivation. */
export function previousWorkflowAgentTurnOrdinal(input: Readonly<{
  executionId: string;
  nodeId: string;
  currentOrdinal: number;
  observedTurnId: string;
}>): number | null {
  for (let ordinal = 0; ordinal < input.currentOrdinal; ordinal += 1) {
    if (workflowAgentPublicTurnId({ ...input, physicalRetryOrdinal: ordinal || null }) === input.observedTurnId) return ordinal;
  }
  return null;
}

/**
 * Resolve the physical retry generation encoded in a public turn id.
 *
 * This is deliberately derived by round-tripping the canonical identity
 * builder rather than accepting a loose suffix. A status response can expose
 * the latest owner of a durable session while an older reconciler is still
 * polling its predecessor; callers need a structural proof that the observed
 * id belongs to this exact workflow node before treating it as a newer owner.
 */
export function workflowAgentTurnOrdinal(input: Readonly<{
  executionId: string;
  nodeId: string;
  observedTurnId: string;
}>): number | null {
  const base = workflowAgentPublicTurnId({
    executionId: input.executionId,
    nodeId: input.nodeId,
    physicalRetryOrdinal: null,
  });
  if (input.observedTurnId === base) return 0;
  const marker = ":physical-retry:";
  const markerIndex = input.observedTurnId.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const suffix = input.observedTurnId.slice(markerIndex + marker.length);
  if (!/^\d+$/.test(suffix)) return null;
  const ordinal = Number(suffix);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) return null;
  return workflowAgentPublicTurnId({
    executionId: input.executionId,
    nodeId: input.nodeId,
    physicalRetryOrdinal: ordinal,
  }) === input.observedTurnId ? ordinal : null;
}
