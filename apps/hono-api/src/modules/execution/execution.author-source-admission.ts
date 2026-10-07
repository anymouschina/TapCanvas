import {
  AUTHOR_SOURCE_REPRESENTATION, authorSourceTextHash, normalizeHarnessAcceptedAuthorSource, verifyServerAuthorSourceRepresentation,
  type AuthorSourceJsonValue, type AuthorSourceRepresentationVerification,
  type AuthorSourceRevisionAttemptV1, type ServerAuthorSourceRepresentationV1,
} from "../../../../../packages/schemas/author-source-representation/index.mjs";
import { WORKFLOW_AUTHOR_DELIVERY_CONVERTER, WORKFLOW_AUTHOR_TRANSPORT_CONVERTER,
  type WorkflowAuthorSourceKernelV1 } from "./execution.author-source";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const rejected = (code: string, path: string): AuthorSourceRepresentationVerification => ({
  status: "current_action_not_applied", diagnostic: { code, path, currentActionApplied: false },
});

/** The caller has already owner-authorized and resolved this exact successful
 * source run. A client body is never a source record. Captured forward outputs
 * attest the original host conversion; admission does not rerun that code. */
export function admitWorkflowAuthorSource(input: Readonly<{
  output: WorkflowNodeOutputV1;
  ownerId: string; flowId: string; flowVersionId: string;
  sourceExecutionId: string; rootNodeId: string; rootNodeRunId: string;
  savedDelivery: string;
  attempt: AuthorSourceRevisionAttemptV1;
}>): AuthorSourceRepresentationVerification {
  const value = input.output.evidence.authorSource;
  if (!record(value)) return rejected("author_source_not_recorded", "/evidence/authorSource");
  if (value.version !== 1 || value.representation !== AUTHOR_SOURCE_REPRESENTATION
    || !record(value.identity) || !record(value.frozenInputs) || !record(value.conversion)
    || !record(value.authorContract) || !record(value.acceptance)
    || !Array.isArray(value.conversion.steps) || !Array.isArray(value.actualForwardOutputs)) {
    return rejected("author_source_kernel_invalid", "/evidence/authorSource");
  }
  const kernel = value as unknown as WorkflowAuthorSourceKernelV1;
  if (!record(kernel.frozenInputs.value) || typeof kernel.frozenInputs.value.sourceContext !== "string") {
    return rejected("author_source_frozen_input_invalid", "/frozenInputs/value");
  }
  try {
    normalizeHarnessAcceptedAuthorSource({ version: kernel.version, representation: kernel.representation,
      identity: { taskId: kernel.identity.taskId, sessionId: kernel.identity.sessionId, turnId: kernel.identity.turnId },
      acceptance: kernel.acceptance, candidate: kernel.candidate, candidateHash: kernel.candidateHash,
      authorContract: kernel.authorContract, sourceContext: { value: kernel.frozenInputs.value.sourceContext,
        hash: authorSourceTextHash(kernel.frozenInputs.value.sourceContext) } });
  } catch { return rejected("author_source_accepted_receipt_invalid", "/acceptance"); }
  if (kernel.identity.taskId !== input.output.evidence.taskId) {
    return rejected("author_source_task_identity_mismatch", "/identity/taskId");
  }
  const registered = [WORKFLOW_AUTHOR_TRANSPORT_CONVERTER, WORKFLOW_AUTHOR_DELIVERY_CONVERTER];
  const converters: { id: string; version: string }[] = [];
  let previousIndex = -1;
  for (const step of kernel.conversion.steps) {
    if (!record(step)) return rejected("author_source_converter_invalid", "/conversion/steps");
    const index = registered.findIndex(item => item.id === step.converterId && item.version === step.converterVersion);
    if (index < 0 || index <= previousIndex) return rejected("author_source_converter_unregistered", "/conversion/steps");
    converters.push(registered[index]); previousIndex = index;
  }
  const identity = { ...kernel.identity, ownerId: input.ownerId, flowId: input.flowId,
    flowVersionId: input.flowVersionId, sourceExecutionId: input.sourceExecutionId,
    rootNodeId: input.rootNodeId, rootNodeRunId: input.rootNodeRunId, leafNodeId: input.output.nodeId };
  const source: ServerAuthorSourceRepresentationV1 = {
    version: kernel.version, representation: kernel.representation,
    identity: { ...kernel.identity, rootNodeId: input.rootNodeId, rootNodeRunId: input.rootNodeRunId },
    acceptance: kernel.acceptance, candidate: kernel.candidate, candidateHash: kernel.candidateHash,
    authorContract: kernel.authorContract,
    frozenInputs: { ref: kernel.frozenInputs.ref, hash: kernel.frozenInputs.hash },
    conversion: kernel.conversion,
  };
  return verifyServerAuthorSourceRepresentation({ serverRecord: source,
    expected: { identity, acceptanceRef: kernel.identity.turnId, candidateHash: kernel.candidateHash,
      authorContract: { ref: kernel.authorContract.ref, value: kernel.authorContract.value },
      frozenInputs: { ref: JSON.stringify({ sourceExecutionId: input.sourceExecutionId, leafNodeId: input.output.nodeId,
        field: "output.evidence.authorSource.frozenInputs.value" }), value: kernel.frozenInputs.value as AuthorSourceJsonValue }, converters },
    actualForwardOutputs: kernel.actualForwardOutputs, savedDelivery: input.savedDelivery, attempt: input.attempt });
}
