import { parseWorkflowKnowledgeCandidateSetV2, WORKFLOW_KNOWLEDGE_CANDIDATE_SET_VERSION } from "@tapcanvas/workflow-kernel-protocol";

export type WorkflowInputLocation = Readonly<{ executionId: string; nodeId: string; revision?: string; path: readonly string[] }>;

/** A prompt projection only. The exact candidate artifact remains in input_refs. */
export function projectWorkflowCandidateInput(value: unknown, location: WorkflowInputLocation): unknown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !("protocolVersion" in value) || value.protocolVersion !== WORKFLOW_KNOWLEDGE_CANDIDATE_SET_VERSION) return null;
  const set = parseWorkflowKnowledgeCandidateSetV2(value);
  const path = [...location.path, "candidates"];
  if (path.length > 32) throw new Error("workflow_candidate_input_path_exceeds_read_protocol");
  return {
    projectionVersion: "workflow.knowledge-candidate-reference/v1",
    sourceProtocolVersion: set.protocolVersion,
    candidateSetId: set.candidateSetId, requestHash: set.requestHash, createdAt: set.createdAt,
    retrievalMode: set.retrievalMode, abstained: set.abstained,
    candidateCount: set.candidates.length, diagnostics: set.diagnostics,
    contentRead: {
      tool: "tapcanvas_execution_node_runs_get",
      args: { executionId: location.executionId, nodeId: location.nodeId, view: "content", field: "input", path, ...(location.revision ? { revision: location.revision } : {}) },
      pagination: { cursor: "offset", next: "nextOffset", consistency: "revision" },
    },
  };
}


export type WorkflowPersistedInputSource = Readonly<{
  nodeId: string;
  revision: string;
  inputs: Readonly<Record<string, readonly unknown[]>>;
}>;

export function collectWorkflowCandidateProjections(
  inputs: Readonly<Record<string, readonly unknown[]>>,
  identity: Readonly<{ executionId: string; persistedInputSource?: WorkflowPersistedInputSource }>,
) {
  const projections: Array<{ source: string; reference: string; requiredTool: string }> = [];
  const requested = new Set<string>();
  const visit = (value: unknown, path: string[], candidate: (value: unknown, path: string[]) => void): void => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && "protocolVersion" in value && value.protocolVersion === WORKFLOW_KNOWLEDGE_CANDIDATE_SET_VERSION) {
      candidate(value, path);
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key], candidate);
  };
  visit(inputs, [], (value) => requested.add(JSON.stringify(value)));
  if (identity.persistedInputSource) {
    const persisted = identity.persistedInputSource;
    visit(persisted.inputs, [], (value, path) => {
      const source = JSON.stringify(value);
      // A sliced/enriched runtime value can only reference an exact persisted
      // source. Never guess a parent path from a temporary item node ID.
      if (!requested.has(source) || path.length >= 32) return;
      const reference = projectWorkflowCandidateInput(value, { executionId: identity.executionId, nodeId: persisted.nodeId, revision: persisted.revision, path });
      projections.push({ source, reference: JSON.stringify(reference), requiredTool: "tapcanvas_execution_node_runs_get" });
      requested.delete(source);
    });
  }
  return { projections, unreferencedCandidateSets: requested.size };
}
