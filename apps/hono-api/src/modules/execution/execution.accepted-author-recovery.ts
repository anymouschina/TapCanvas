import { AUTHOR_SOURCE_REPRESENTATION, authorSourceTextHash, normalizeHarnessAcceptedAuthorSource,
	type HarnessAcceptedAuthorSourceV1 } from "../../../../../packages/schemas/author-source-representation/index.mjs";
import { workflowAgentSessionKey, workflowAgentTurnOrdinal } from "./execution.agent-identity";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";

export type WorkflowAcceptedAuthorRecoveryV1 = Readonly<{
	version: 1;
	sourceExecutionId: string;
	sourceNodeRunId: string;
	nodeId: string;
	portName: string;
	identity: HarnessAcceptedAuthorSourceV1["identity"];
	candidate: string;
	candidateHash: string;
	sourceContext: HarnessAcceptedAuthorSourceV1["sourceContext"];
	/** Present only when the complete original harness acceptance verifies. */
	acceptedAuthorSource?: HarnessAcceptedAuthorSourceV1;
	sourceDiagnostics: readonly Readonly<{ code: string; path: string; status: "source_candidate_preserved_contract_unverified" }>[];
}>;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Owner authorization belongs to the persisted checkpoint lookup. This reader
 * proves original text/source identity; a damaged contract remains diagnostic,
 * never an invented harness acceptance or permission to bypass compilation. */
export function readWorkflowAcceptedAuthorRecovery(evidence: Record<string, unknown> | null | undefined): WorkflowAcceptedAuthorRecoveryV1 | null {
	const value = evidence?.acceptedAuthorRecovery;
	if (value === undefined || value === null) return null;
	if (!record(value) || value.version !== 1 || ["sourceExecutionId", "sourceNodeRunId", "nodeId", "portName"].some(key => typeof value[key] !== "string" || !value[key])) {
		throw new Error("workflow_accepted_author_recovery_invalid");
	}
	const source = value.sourceRecord;
	if (!record(source) || source.version !== 1 || source.representation !== AUTHOR_SOURCE_REPRESENTATION
		|| !record(source.identity) || !record(source.sourceContext)
		|| typeof source.identity.taskId !== "string" || typeof source.identity.sessionId !== "string"
		|| typeof source.identity.turnId !== "string" || !source.identity.turnId
		|| typeof source.candidate !== "string" || !source.candidate
		|| source.candidateHash !== authorSourceTextHash(source.candidate)
		|| typeof source.sourceContext.value !== "string"
		|| source.sourceContext.hash !== authorSourceTextHash(source.sourceContext.value)) {
		throw new Error("workflow_accepted_author_recovery_candidate_proof_invalid");
	}
	const sourceExecutionId = value.sourceExecutionId as string;
	const nodeId = value.nodeId as string;
	if (source.identity.taskId !== evidence?.taskId || workflowAgentTurnOrdinal({
		executionId: sourceExecutionId, nodeId, observedTurnId: source.identity.taskId }) === null
		|| source.identity.sessionId !== workflowAgentSessionKey({ executionId: sourceExecutionId, nodeId, physicalRetryOrdinal: null })) {
		throw new Error("workflow_accepted_author_recovery_identity_mismatch");
	}
	let accepted: HarnessAcceptedAuthorSourceV1 | null = null;
	const sourceDiagnostics: Array<WorkflowAcceptedAuthorRecoveryV1["sourceDiagnostics"][number]> = [];
	try { accepted = normalizeHarnessAcceptedAuthorSource(source); }
	catch (error: unknown) {
		// Persisted object ordering cannot prove the historical contract bytes.
		// Keep that failure explicit and only reuse the separately verified text.
		if (!record(error) || error.code !== "author_source_contract_mismatch" || error.path !== "/acceptedAuthorSource/authorContract/hash") throw error;
		sourceDiagnostics.push({ code: error.code, path: error.path, status: "source_candidate_preserved_contract_unverified" });
	}
	return { version: 1, sourceExecutionId, sourceNodeRunId: value.sourceNodeRunId as string,
		nodeId, portName: value.portName as string,
		identity: { taskId: source.identity.taskId, sessionId: source.identity.sessionId, turnId: source.identity.turnId },
		candidate: source.candidate, candidateHash: source.candidateHash as string,
		sourceContext: { value: source.sourceContext.value, hash: source.sourceContext.hash as string },
		...(accepted ? { acceptedAuthorSource: accepted } : {}), sourceDiagnostics };
}

/** A rejected host compilation does not erase the author's original candidate.
 * Its source receipt is preserved unchanged for one current-contract recheck. */
export function bindWorkflowAcceptedAuthorRecovery(input: Readonly<{
	output: WorkflowNodeOutputV1;
	sourceExecutionId: string;
	sourceNodeRunId: string;
}>): WorkflowNodeOutputV1 {
	const retained = readWorkflowAcceptedAuthorRecovery(input.output.evidence);
	if (retained) {
		if (retained.nodeId !== input.output.nodeId) throw new Error("workflow_accepted_author_recovery_node_mismatch");
		return input.output;
	}
	const failure = input.output.evidence.outputContractFailure;
	if (!record(failure) || failure.code !== "structured_output_invalid") return input.output;
	let found: Record<string, unknown> | null = null;
	for (const [portName, port] of Object.entries(input.output.ports)) {
		if (!record(port) || port.acceptedAuthorSource === undefined) continue;
		const receipt = { version: 1 as const, sourceExecutionId: input.sourceExecutionId,
			sourceNodeRunId: input.sourceNodeRunId, nodeId: input.output.nodeId, portName, sourceRecord: port.acceptedAuthorSource };
		const proof = readWorkflowAcceptedAuthorRecovery({ ...input.output.evidence, acceptedAuthorRecovery: receipt });
		if (!proof || port.text !== proof.candidate) throw new Error("workflow_accepted_author_recovery_candidate_mismatch");
		if (found && JSON.stringify(found.sourceRecord) !== JSON.stringify(receipt.sourceRecord)) {
			throw new Error("workflow_accepted_author_recovery_source_ambiguous");
		}
		found = found ?? receipt;
	}
	if (!found) return input.output;
	return { ...input.output, evidence: { ...input.output.evidence, acceptedAuthorRecovery: found } };
}
