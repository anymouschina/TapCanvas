import { AUTHOR_SOURCE_REPRESENTATION, authorSourceJsonHash, authorSourceTextHash,
  normalizeHarnessAcceptedAuthorSource, type AuthorSourceIdentityV1, type AuthorSourceJsonValue,
  type HarnessAcceptedAuthorSourceV1, type ServerAuthorSourceRepresentationV1 } from "../../../../../packages/schemas/author-source-representation/index.mjs";

export type WorkflowAuthorSourceConversion = ServerAuthorSourceRepresentationV1["conversion"]["steps"][number];
export type WorkflowAuthorSourceForwardStep = Readonly<{ converterId: string; converterVersion: string; text: string }>;
/** Versioned registration of the actually executed host projection boundaries.
 * These record forward results; reading the receipt does not rerun converters. */
export const WORKFLOW_AUTHOR_TRANSPORT_CONVERTER = Object.freeze({ id: "workflow.agent-array-envelope-projection", version: "1" });
export const WORKFLOW_AUTHOR_DELIVERY_CONVERTER = Object.freeze({ id: "workflow.agent-typed-delivery-projection", version: "1" });
export type WorkflowAuthorSourceKernelV1 = Readonly<{
  version: 1; representation: typeof AUTHOR_SOURCE_REPRESENTATION;
  identity: Omit<AuthorSourceIdentityV1, "rootNodeId" | "rootNodeRunId">;
  acceptance: HarnessAcceptedAuthorSourceV1["acceptance"];
  candidate: string; candidateHash: string;
  authorContract: HarnessAcceptedAuthorSourceV1["authorContract"];
  frozenInputs: Readonly<{ ref: string; value: AuthorSourceJsonValue; hash: string }>;
  conversion: Readonly<{ steps: readonly WorkflowAuthorSourceConversion[]; deliveryHash: string }>;
  actualForwardOutputs: readonly string[];
}>;

export function projectWorkflowAuthorSource(input: Readonly<{
  identity: Readonly<{ ownerId: string; flowId: string; flowVersionId?: string; sourceExecutionId: string; leafNodeId: string; taskId: string }>;
  accepted: unknown; transportSteps?: readonly WorkflowAuthorSourceForwardStep[];
  hostInputText: string; deliveryText: string; frozenInputs: unknown;
}>): Readonly<{ authorSource?: WorkflowAuthorSourceKernelV1; authorSourceIssue?: string }> {
  try {
    const accepted = normalizeHarnessAcceptedAuthorSource(input.accepted);
    if (!accepted) return { authorSourceIssue: "accepted_author_source_not_recorded" };
    if (Object.values(input.identity).some(value => typeof value !== "string" || !value)
      || !input.identity.flowVersionId || accepted.identity.taskId !== input.identity.taskId) {
      return { authorSourceIssue: "accepted_author_source_execution_identity_mismatch" };
    }
    const frozenValue: AuthorSourceJsonValue = JSON.parse(JSON.stringify({ inputs: input.frozenInputs, sourceContext: accepted.sourceContext.value }));
    const frozenRef = JSON.stringify({ sourceExecutionId: input.identity.sourceExecutionId,
      leafNodeId: input.identity.leafNodeId, field: "output.evidence.authorSource.frozenInputs.value" });
    const frozenHash = authorSourceJsonHash(frozenValue);
    let priorText = accepted.candidate;
    const steps: WorkflowAuthorSourceConversion[] = [];
    const outputs: string[] = [];
    const append = (step: WorkflowAuthorSourceForwardStep): void => {
      steps.push({ converterId: step.converterId, converterVersion: step.converterVersion,
        inputHash: authorSourceTextHash(priorText), outputHash: authorSourceTextHash(step.text),
        frozenInputHash: frozenHash, frozenInputRef: frozenRef });
      outputs.push(step.text); priorText = step.text;
    };
    for (const step of input.transportSteps ?? []) {
      if (step.converterId !== WORKFLOW_AUTHOR_TRANSPORT_CONVERTER.id || step.converterVersion !== WORKFLOW_AUTHOR_TRANSPORT_CONVERTER.version) {
        return { authorSourceIssue: "accepted_author_source_transport_converter_unregistered" };
      }
      append(step);
    }
    if (priorText !== input.hostInputText) return { authorSourceIssue: "accepted_author_source_transport_text_mismatch" };
    if (input.deliveryText !== input.hostInputText) append({ converterId: WORKFLOW_AUTHOR_DELIVERY_CONVERTER.id,
      converterVersion: WORKFLOW_AUTHOR_DELIVERY_CONVERTER.version, text: input.deliveryText });
    return { authorSource: { version: 1, representation: AUTHOR_SOURCE_REPRESENTATION,
      identity: { ...input.identity, flowVersionId: input.identity.flowVersionId, sessionId: accepted.identity.sessionId, turnId: accepted.identity.turnId },
      acceptance: accepted.acceptance, candidate: accepted.candidate, candidateHash: accepted.candidateHash,
      authorContract: accepted.authorContract, frozenInputs: { ref: frozenRef, value: frozenValue, hash: frozenHash },
      conversion: { steps, deliveryHash: authorSourceTextHash(input.deliveryText) }, actualForwardOutputs: outputs } };
  } catch { return { authorSourceIssue: "accepted_author_source_receipt_invalid" }; }
}

/** A normalizer at trusted bridge/durable return boundaries. Missing or damaged
 * source evidence is diagnostic and never changes the returned delivery. */
export function projectAcceptedWorkflowAuthorSource(value: unknown, candidate: string): Readonly<{
  acceptedAuthorSource?: HarnessAcceptedAuthorSourceV1; acceptedAuthorSourceIssue?: string;
}> {
  try {
    const accepted = normalizeHarnessAcceptedAuthorSource(value);
    if (!accepted) return {};
    if (accepted.candidate !== candidate) return { acceptedAuthorSourceIssue: "accepted_author_source_return_text_mismatch" };
    return { acceptedAuthorSource: accepted };
  } catch { return { acceptedAuthorSourceIssue: "accepted_author_source_record_invalid" }; }
}
